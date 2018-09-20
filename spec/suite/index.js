var co = require('co');
var Schema = require('chaos-database').Schema;
var Sqlite = require('../../src');
var Dialect = require('sql-dialect').Dialect;

Promise = require('bluebird');

function getConnection() {
  return new Sqlite({ database: ':memory:' });
}

describe("Sqlite", function() {

  before(function() {
    this.connection = getConnection();
  });

  after(function() {
    this.connection.disconnect();
  });

  describe(".constructor()", function() {

    it("allows to inject a dialect instance", function() {

      var dialect = new Dialect();
      var connection = new Sqlite({ dialect: dialect });

      expect(connection.dialect()).toBe(dialect);

    });

    it("correctly sets up a default dialect instance.", function() {

      var dialect = this.connection.dialect();

      expect(dialect.quote('tablename')).toBe("'tablename'");

      expect(dialect.value('string_value', {
        name: 'string_field',
        type: function(name) {
          if (name === 'string_field') {
            return 'string';
          }
        }
      })).toBe("'string_value'");

    });

  });

  describe(".enabled()", function() {

    it("returns `true` for enabled features, false otherwise.", function() {

      expect(Sqlite.enabled()).toEqual({
        arrays: false,
        transactions: true,
        savepoints: true,
        booleans: true,
        default: false
      });
      expect(Sqlite.enabled('arrays')).toBe(false);
      expect(Sqlite.enabled('transactions')).toBe(true);
      expect(Sqlite.enabled('savepoints')).toBe(true);
      expect(Sqlite.enabled('booleans')).toBe(true);
      expect(Sqlite.enabled('default')).toBe(false);

    });

  });

  describe(".connect()", function() {

    it("throws an exception if no database name is set", function(done) {

      new Sqlite().connect().then(function() {
        expect(false).toBe(true);
      }).catch(function(err) {
        expect(err.message).toMatch(/Error, no database name has been configured./);
        done();
      });

    });

    it("returns the same connection when called multiple times.", function(done) {

      co(function*() {
        var expected = yield this.connection.connect();

        var actual = yield this.connection.connect();
        expect(actual).toBe(expected);

        actual = yield this.connection.connect();
        expect(actual).toBe(expected);
      }.bind(this)).then(function() {
        done();
      });

    });

  });

  describe(".client()", function() {

    it("returns the connected client.", function(done) {

      co(function*() {
        var connection = new getConnection();
        expect(connection.client()).toBe(undefined);
        yield connection.connect();
        expect(connection.client()).toBeAn('object');
        connection.disconnect();
      }.bind(this)).then(function() {
        done();
      });

    });

  });

  describe(".connected()", function() {

    it("returns `true` when connected.", function(done) {

      co(function*() {
        yield this.connection.connect();
        expect(this.connection.connected()).toBe(true);
      }.bind(this)).then(function() {
        done();
      });

    });

    it("returns `false` when not connected.", function() {

      var connection = new Sqlite();
      expect(connection.connected()).toBe(false);

    });

  });

  describe(".query()", function() {

    it("returns a cursor instance on success", function(done) {

      co(function*() {
        var response = yield this.connection.query("SELECT 1 + 1 as sum");
        var row = response.next();
        expect(row.sum).toBe(2);
        done();
      }.bind(this));

    });

    it("returns `true` on success when no data are available", function(done) {

      co(function*() {
        var schema = new Schema({ connection: this.connection });
        schema.source('gallery');
        schema.column('id', { type: 'serial' });
        schema.column('name', { type: 'string' });
        yield schema.create();

        expect(yield schema.insert({ name: 'new gallery' })).toBe(true);
        var id = schema.lastInsertId();

        expect(yield schema.update({ name: 'updated gallery' }, { name: 'new gallery' })).toBe(true);

        var cursor = yield this.connection.query('SELECT "name" FROM "gallery" WHERE "id" = ' + id);
        var gallery = cursor.next();
        expect(gallery.name).toBe('updated gallery');

        expect(yield schema.remove({ id: id })).toBe(true);

        var cursor = yield this.connection.query('SELECT "name" FROM "gallery" WHERE "id" = ' + id);
        expect(cursor.valid()).toBe(false);

        yield schema.drop();
        done();
      }.bind(this));

    });

    it("rejects the promise when an error occurs.", function(done) {

      co(function*() {
        var response = yield this.connection.query("SELECT * FROM");
      }.bind(this)).then(function() {
        expect(false).toBe(true);
      }).catch(function(err) {
        expect(err.code).toBe('SQLITE_ERROR');
        done();
      });

    });

  });

  describe(".execute()", function() {

    it("executes raw queries", function(done) {

      co(function*() {
        var schema = new Schema({ connection: this.connection });
        schema.source('gallery');
        schema.column('id', { type: 'serial' });
        schema.column('name', { type: 'string' });
        yield schema.create();

        yield this.connection.openTransaction();

        yield schema.insert({ name: 'new gallery' });
        var id = schema.lastInsertId();
        var cursor = yield this.connection.query('SELECT "name" FROM "gallery" WHERE "id" = ' + id);
        var gallery = cursor.next();
        expect(gallery.name).toBe('new gallery');

        yield this.connection.execute("ROLLBACK");

        cursor = yield this.connection.query('SELECT "name" FROM "gallery" WHERE "id" = ' + id);
        expect(cursor.next()).toBe(undefined);

        yield schema.drop();
        done();
      }.bind(this));
    });

  });

  describe(".sources()", function() {

    it("shows sources", function(done) {

      co(function*() {
        var schema = new Schema({ connection: this.connection });
        schema.source('gallery');
        schema.column('id', { type: 'serial' });
        yield schema.create();

        var sources = yield this.connection.sources();

        expect(sources).toEqual({
          gallery: 'gallery'
        });

        yield schema.drop();
      }.bind(this)).then(function() {
        done();
      });
    });

  });

  describe(".describe()", function() {

    beforeEach(function() {

      this.schema = new Schema();
      this.schema.source('gallery');
      this.schema.column('id', { type: 'serial' });
      this.schema.column('name', {
        type: 'string',
        length: 128,
        default: 'Johnny Boy'
      });
      this.schema.column('active', {
        type: 'boolean',
        default: true
      });
      this.schema.column('inactive', {
        type: 'boolean',
        default: false
      });
      this.schema.column('money', {
        type: 'decimal',
        length: 10,
        precision: 2
      });
      this.schema.column('created', {
        type: 'datetime',
        use: 'timestamp',
        default: { ':plain': 'CURRENT_TIMESTAMP' }
      });

    });

    it("describe a source", function(done) {

      co(function*() {
        this.schema.connection(this.connection);
        yield this.schema.create();

        var gallery = yield this.connection.describe('gallery');

        expect(gallery.column('id')).toEqual({
          use: 'integer',
          type: 'integer',
          null: false,
          default: null,
          array: false
        });

        expect(gallery.column('name')).toEqual({
          use: 'varchar',
          type: 'string',
          length: 128,
          null: false,
          default: 'Johnny Boy',
          array: false
        });

        expect(gallery.column('active')).toEqual({
          use: 'boolean',
          type: 'boolean',
          null: false,
          default: true,
          array: false
        });

        expect(gallery.column('inactive')).toEqual({
          use: 'boolean',
          type: 'boolean',
          null: false,
          default: false,
          array: false
        });

        expect(gallery.column('money')).toEqual({
          use: 'decimal',
          type: 'decimal',
          length: 10,
          precision: 2,
          null: false,
          default: null,
          array: false
        });

        expect(gallery.column('created')).toEqual({
          use: 'timestamp',
          type: 'datetime',
          null: false,
          default: null,
          array: false
        });

        yield this.schema.drop();
      }.bind(this)).then(function() {
        done();
      });

    });

    it("creates a schema instance without introspection", function(done) {

      co(function*() {

        var gallery = yield this.connection.describe('gallery', this.schema.columns());

        expect(gallery.column('id')).toEqual({
          type: 'serial',
          null: false,
          array: false
        });

        expect(gallery.column('name')).toEqual({
          type: 'string',
          length: 128,
          null: false,
          default: 'Johnny Boy',
          array: false
        });

        expect(gallery.column('active')).toEqual({
          type: 'boolean',
          null: false,
          default: true,
          array: false
        });

        expect(gallery.column('inactive')).toEqual({
          type: 'boolean',
          null: false,
          default: false,
          array: false
        });

        expect(gallery.column('money')).toEqual({
          type: 'decimal',
          length: 10,
          precision: 2,
          null: false,
          array: false
        });

        expect(gallery.column('created')).toEqual({
          use: 'timestamp',
          type: 'datetime',
          null: false,
          array: false,
          default: { ':plain': 'CURRENT_TIMESTAMP' }
        });
      }.bind(this)).then(function() {
        done();
      });

    });

  });

  describe(".lastInsertId()", function() {

    it("gets the encoding last insert ID", function(done) {

      co(function*() {
        var schema = new Schema({ connection: this.connection });
        schema.source('gallery');
        schema.column('id',   { type: 'serial' });
        schema.column('name', { type: 'string', null: true });
        yield schema.create();

        yield schema.insert({ name: 'new gallery' });
        expect(schema.lastInsertId()).toBe(1);

        yield schema.drop();
      }.bind(this)).then(function() {
        done();
      });

    });

    it("gets the encoding last insert ID even with an empty record", function(done) {

      co(function*() {
        var schema = new Schema({ connection: this.connection });
        schema.source('gallery');
        schema.column('id',   { type: 'serial' });
        schema.column('name', { type: 'string', null: true });
        yield schema.create();

        yield schema.insert({});
        expect(schema.lastInsertId()).toBe(1);

        yield schema.drop();
      }.bind(this)).then(function() {
        done();
      });

    });

  });

  describe(".disconnect()", function() {

    it("disconnects the client.", function(done) {

      co(function*() {
        var connection = getConnection();

        expect(connection.disconnect()).toBe(true);
        expect(connection.connected()).toBe(false);

        yield connection.connect();
        expect(connection.connected()).toBe(true);

        expect(connection.disconnect()).toBe(true);
        expect(connection.connected()).toBe(false);

      }.bind(this)).then(function() {
        done();
      });

    });

  });

  describe(".convert()", function() {

    it("formats according default `'datasource'` handlers", function() {

      expect(this.connection.convert('datasource', 'id', 123)).toBe('123');
      expect(this.connection.convert('datasource', 'serial', 123)).toBe('123');
      expect(this.connection.convert('datasource', 'integer', 123)).toBe('123');
      expect(this.connection.convert('datasource', 'float', 12.3)).toBe('12.3');
      expect(this.connection.convert('datasource', 'decimal', 12.3)).toBe('12.30');
      var date = new Date('2014-11-21');
      expect(this.connection.convert('datasource', 'date', date)).toBe("'2014-11-21'");
      expect(this.connection.convert('datasource', 'date', '2014-11-21')).toBe("'2014-11-21'");
      var datetime = new Date('2014-11-21T10:20:45.000Z');
      expect(this.connection.convert('datasource', 'datetime', datetime)).toBe("'2014-11-21 10:20:45'");
      expect(this.connection.convert('datasource', 'datetime', '2014-11-21T10:20:45+02:00')).toBe("'2014-11-21 08:20:45'");
      expect(this.connection.convert('datasource', 'boolean', true)).toBe('1');
      expect(this.connection.convert('datasource', 'boolean', false)).toBe('0');
      expect(this.connection.convert('datasource', 'null', null)).toBe('NULL');
      expect(this.connection.convert('datasource', 'string', 'abc')).toBe("'abc'");
      expect(this.connection.convert('datasource', '_default_', 123)).toBe("'123'");
      expect(this.connection.convert('datasource', '_undefined_', 123)).toBe("'123'");

    });

    it("formats according default `'cast'` handlers", function() {

      expect(this.connection.convert('cast', 'id', '123')).toBe(123);
      expect(this.connection.convert('cast', 'serial', '123')).toBe(123);
      expect(this.connection.convert('cast', 'integer', '123')).toBe(123);
      expect(this.connection.convert('cast', 'float', '12.3')).toBe(12.3);
      expect(this.connection.convert('cast', 'decimal', '12.3')).toBe('12.30');
      var date = new Date('2014-11-21');
      expect(this.connection.convert('cast', 'date', date)).toEqual(date);
      expect(this.connection.convert('cast', 'date', '2014-11-21')).toEqual(date);
      var datetime = new Date('2014-11-21 10:20:45');
      expect(this.connection.convert('cast', 'datetime', datetime)).toEqual(datetime);
      expect(this.connection.convert('cast', 'datetime', '2014-11-21 10:20:45')).toEqual(new Date('2014-11-21T10:20:45.000Z'));
      expect(this.connection.convert('cast', 'datetime', 1416565245)).toEqual(new Date('2014-11-21T10:20:45.000Z'));
      expect(this.connection.convert('cast', 'boolean', 1)).toBe(true);
      expect(this.connection.convert('cast', 'boolean', 0)).toBe(false);
      expect(this.connection.convert('cast', 'null', 'NULL')).toBe(null);
      expect(this.connection.convert('cast', 'string', 'abc')).toBe('abc');
      expect(this.connection.convert('cast', '_default_', 123)).toBe(123);
      expect(this.connection.convert('cast', '_undefined_', 123)).toBe(123);

    });

    it("formats `null` values", function() {

      expect(this.connection.convert('datasource', 'id', null)).toBe('NULL');
      expect(this.connection.convert('datasource', 'serial', null)).toBe('NULL');
      expect(this.connection.convert('datasource', 'integer', null)).toBe('NULL');
      expect(this.connection.convert('datasource', 'float', null)).toBe('NULL');
      expect(this.connection.convert('datasource', 'decimal', null)).toBe('NULL');
      expect(this.connection.convert('datasource', 'date', null)).toBe('NULL');
      expect(this.connection.convert('datasource', 'datetime', null)).toBe('NULL');
      expect(this.connection.convert('datasource', 'boolean', null)).toBe('NULL');
      expect(this.connection.convert('datasource', 'null', null)).toBe('NULL');
      expect(this.connection.convert('datasource', 'string', null)).toBe('NULL');
      expect(this.connection.convert('datasource', '_default_',null)).toBe('NULL');
      expect(this.connection.convert('datasource', '_undefined_', null)).toBe('NULL');

    });

  });

});
