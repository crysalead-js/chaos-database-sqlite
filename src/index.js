var co = require('co');
var sqlite3 = require('sqlite3');
var extend = require('extend-merge').extend;
var merge = require('extend-merge').merge;
var Database = require('chaos-database').Database;
var SqliteDialect = require('sql-dialect').Sqlite;

/**
 * SQLite adapter
 */
class Sqlite extends Database {
  /**
   * Check for required PHP extension, or supported database feature.
   *
   * @param  String  feature Test for support for a specific feature, i.e. `"transactions"`
   *                         or `"arrays"`.
   * @return Boolean         Returns `true` if the particular feature is supported, `false` otherwise.
   */
  static enabled(feature) {
    var features = {
      arrays: false,
      transactions: true,
      savepoints: true,
      booleans: true,
      default: false
    };
    if (!arguments.length) {
      return extend({}, features);
    }
    return features[feature];
  }

  /**
   * Constructs the SQLite adapter and sets the default port to 3306.
   *
   * @param Object config Configuration options for this class. Available options
   *                      defined by this class:
   *                      - `'host'`: _string_ The IP or machine name where SQLite is running,
   *                                  followed by a colon, followed by a port number or socket.
   *                                  Defaults to `'localhost'`.
   */
  constructor(config) {
    var defaults = {
      classes: {
        dialect: SqliteDialect
      },
      database: undefined,
      mode : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
      connect: true,
      alias: true,
      client: undefined,
      dialect: true
    };
    config = merge({}, defaults, config);
    super(config);

    /**
     * Specific value denoting whether or not table aliases should be used in DELETE and UPDATE queries.
     *
     * @var Boolean
     */
    this._alias = config.alias;

    /**
     * Stores a connection to a remote resource.
     *
     * @var Function
     */
    this._client = config.client;

    /**
     * Whether the client is connected or not.
     *
     * @var Boolean
     */
    this._connected = false;

    this.formatter('datasource', 'boolean', function(value, options) {
      return value ? '1' : '0';
    });

    if (typeof this._dialect === 'object') {
      return;
    }

    var dialect = this.classes().dialect;

    this._dialect = new dialect({
      caster: function(value, states) {
        var type;
        if (states && states.schema) {
          type = states.schema.type(states.name);
        }
        type = type ? type : this.constructor.getType(value);
        return this.convert('datasource', type, value);
      }.bind(this)
    });
  }

  /**
   * Returns the client instance.
   *
   * @return Function
   */
  client() {
    return this._client;
  }

  /**
   * Connects to the database using the options provided to the class constructor.
   *
   * @return boolean Returns `true` if a database connection could be established,
   *                 otherwise `false`.
   */
  connect() {
    if (this._client) {
      return Promise.resolve(this._client);
    }

    var config = this.config();

    if (!config.database) {
      return Promise.reject(new Error('Error, no database name has been configured.'));
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var client = self._client = new sqlite3.Database(config.database, config.mode, function(err) {
        if (err) {
          return reject(new Error('Unable to connect, error ' + err.code + ' ' + err.stack));
        }
        self._connected = true;
        accept(client)
      });
    });
  }

  /**
   * Checks the connection status of this data source.
   *
   * @return Boolean Returns a boolean indicating whether or not the connection is currently active.
   *                 This value may not always be accurate, as the connection could have timed out or
   *                 otherwise been dropped by the remote resource during the course of the request.
   */
  connected() {
    return this._connected;
  }

  /**
   * Opens a transaction
   *
   * @return Promise
   */
  openTransaction() {
    return this.execute('BEGIN TRANSACTION');
  }

  /**
   * Finds records using a SQL query.
   *
   * @param  string sql  SQL query to execute.
   * @param  array  data Array of bound parameters to use as values for query.
   *                     WARNING data must be clean at this step. SQL injection must be handled earlier.
   * @return object      A `Cursor` instance.
   */
  query(sql, data, options) {
    var self = this;
    return new Promise(function(accept, reject) {
      var defaults = {};
      options = extend({}, defaults, options);

      var cursor = self.constructor.classes().cursor;

      var response = function(err, data) {
        if (err) {
          reject(err);
          return;
        }
        if (typeof this.lastID !== undefined) {
          self._lastInsertId = this.lastID;
        }
        accept(data ? new cursor({ data: data }) : true);
      };

      // Thanks node-sqlite3 for such crappy API SQL !
      self.connect().then(function(client) {
        if (sql.match(/^(SELECT|PRAGMA)/i)) {
          client.all(sql, response);
        } else {
          client.run(sql, response);
        }
      });
    });
  }

  /**
   * Execute a raw query.
   *
   * @param  string  sql SQL query to execute.
   * @return Promise
   */
  execute(sql) {
    var self = this;
    return new Promise(function(accept, reject) {
      self.connect().then(function(client) {
        client.run(sql, function(err, data) {
          if (err) {
            reject(err);
            return;
          }
          accept();
        });
      });
    });
  }

  /**
   * Returns the last insert id from the database.
   *
   * @return mixed Returns the last insert id.
   */
  lastInsertId() {
    return this._lastInsertId;
  }

  /**
   * Returns the list of tables in the currently-connected database.
   *
   * @return Object Returns an object of sources to which models can connect.
   */
  sources() {
    var select = this.dialect().statement('select');
    select.fields('name')
      .from('sqlite_master')
      .where({ type: 'table' });
    return this._sources(select);
  }

  /**
   * Extracts fields definitions of a table.
   *
   * @param  String name The table name.
   * @return Object      The fields definitions.
   */
  fields(name) {
    return co(function*() {
      var tmp, fields = [];
      var columns = yield this.query('PRAGMA table_info(' + name +')');
      for (var column of columns) {
        var field = this._field(column);
        var dflt = column.dflt_value;

        switch (field.type) {
          case 'string':
            var matches = typeof dflt === 'string' ? dflt.match(/^'(.*)'/) : null;
            if (matches) {
              dflt = matches[1];
            }
            break;
          case 'boolean':
            dflt = dflt === '1';
            break;
          case 'date':
          case 'datetime':
            dflt = null;
            break;
        }

        tmp = {};
        tmp[column.name] = extend({}, {
          null: (column.notnull === 0 ? true : false),
          'default': dflt
        }, field);

        fields.push(tmp);
      }
      return fields;
    }.bind(this));
  }

  /**
   * Converts database-layer column to a generic field.
   *
   * @param  Object column Database-layer column.
   * @return Object        A generic field.
   */
  _field(column) {
    var matches = column.type.match(/(\w+)(?:\(([\d,]+)\))?/);
    var field = {};
    field.type = matches[1];
    field.length = matches[2];
    field.use = field.type;

    if (field.length) {
      var length = field.length.split(',');
      field.length = Number.parseInt(length[0]);
      if (length[1]) {
        field.precision = Number.parseInt(length[1]);
      }
    }

    field.type = this.dialect().mapped(field);
    return field;
  }

  /**
   * Disconnects the adapter from the database.
   *
   * @return Boolean Returns `true` on success, else `false`.
   */
  disconnect() {
    if (!this._client) {
      return true;
    }
    this._client.close();
    this._client = undefined;
    this._connected = false;
    return true;
  }
}

module.exports = Sqlite;
