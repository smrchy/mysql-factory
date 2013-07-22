(function() {
  var Datamodel, EventEmitter, async, bcrypt, moment, redisHashPrefix, sys, utils, _, _timestampField,
    __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  sys = require("sys");

  async = require("async");

  moment = require('moment');

  _ = require('lodash')._;

  _.string = require("underscore.string");

  EventEmitter = require("events").EventEmitter;

  utils = require("../lib/utils");

  bcrypt = require("bcrypt");

  redisHashPrefix = "modeldata:";

  _timestampField = "_t";

  Datamodel = (function(_super) {
    __extends(Datamodel, _super);

    Datamodel.prototype.tablename = "tablename";

    Datamodel.prototype.cachekey = null;

    Datamodel.prototype.fields = {};

    Datamodel.prototype.relations = {};

    Datamodel.prototype.sIdField = "id";

    Datamodel.prototype.hasStringId = false;

    Datamodel.prototype.autoinit = true;

    Datamodel.prototype.defaultGetOptions = {
      fields: "all"
    };

    function Datamodel(settings) {
      this._getLimiterStatement = __bind(this._getLimiterStatement, this);
      this._getSorting = __bind(this._getSorting, this);
      this._reduceSortFields = __bind(this._reduceSortFields, this);
      this._postProcessField = __bind(this._postProcessField, this);
      this._postProcess = __bind(this._postProcess, this);
      this._generalReturnObject = __bind(this._generalReturnObject, this);
      this._generateReturnObject = __bind(this._generateReturnObject, this);
      this._generalReturn = __bind(this._generalReturn, this);
      this.settings = settings;
      this.init();
    }

    Datamodel.prototype.init = function() {
      if (this.settings.connector) {
        this.connector = this.settings.connector;
      }
      if (this.settings.tablename) {
        this.tablename = this.settings.tablename;
      }
      if (this.settings.useRedisCache) {
        this.cachekey = "" + redisHashPrefix + this.settings.tablename + ":";
      }
      if (this.settings.sIdField) {
        this.sIdField = this.settings.sIdField;
      }
      if (this.settings.fields) {
        this.fields = this.settings.fields;
      }
      if (this.settings.relations) {
        this.relations = this.settings.relations;
      }
      if (this.settings.factory) {
        this.factory = this.settings.factory;
      }
      if (_.isBoolean(this.settings.hasStringId) && this.settings.hasStringId) {
        this.hasStringId = true;
      } else {
        this.hasStringId = false;
      }
      if (_.isBoolean(this.settings.useFieldsets) && this.settings.useFieldsets) {
        this.useFieldsets = true;
      } else {
        this.useFieldsets = false;
      }
      this.redis = null;
      this._initFields();
      if (this.settings.sortfield != null) {
        this.sortfield = this._reduceSortFields(this.settings.sortfield);
        this.sortdirection = this.settings.sortdirection.toUpperCase() || "ASC";
      }
      this._loadIDs();
      this.oIdField = this.fields[this.sIdField];
      return this.emit("loaded");
    };

    Datamodel.prototype.get = function(id, callback, options) {
      var filter, fnGet,
        _this = this;
      options = _.extend({
        type: "get",
        forceDBload: false,
        _customQueryEnd: ""
      }, this.defaultGetOptions, options);
      filter = {};
      fnGet = function(filter, callback, options) {
        var filterReturn, sStatement;
        filterReturn = this._generateFilter(filter);
        sStatement = "SELECT " + (this._getFields(options.fields).join(", ")) + " FROM " + this.tablename + " " + filterReturn.filter + " " + options._customQueryEnd;
        return this.connector.query(sStatement, filterReturn.args, _.bind(this._singleReturn, this, options, filter, callback));
      };
      if (this.settings.useRedisCache && this.cachekey && !options.forceDBload) {
        this.redis.get(this.cachekey + id, function(err, res) {
          if (res === null) {
            filter[_this.sIdField] = id;
            return fnGet.call(_this, filter, callback, options);
          } else {
            return _this._generalReturnObject(0, callback, JSON.parse(res), options.type);
          }
        });
      } else {
        if (_.isArray(this.sIdField) && !(_.isString(id) || _.isNumber(id))) {
          fnGet.call(this, id, callback, options);
        } else if (_.isString(id) || _.isNumber(id)) {
          filter[this.sIdField] = id;
          fnGet.call(this, filter, callback, options);
        } else {
          this._generalReturnObject("wrong-id-type", callback, id, options.type);
        }
      }
    };

    Datamodel.prototype.mget = function(aIds, callback, options) {
      var filter, filterReturn, sStatement;
      options = _.extend({
        type: "mget",
        _customQueryEnd: ""
      }, this.defaultGetOptions, options);
      filter = {};
      if (aIds && aIds.length) {
        filter[this.sIdField] = aIds;
        filterReturn = this._generateFilter(filter);
        sStatement = "SELECT " + (this._getFields(options.fields).join(", ")) + " FROM " + this.tablename + " " + filterReturn.filter + " " + (this._getSorting(options)) + " " + (this._getLimiterStatement(filter)) + " " + options._customQueryEnd;
        this.connector.query(sStatement, filterReturn.args, _.bind(this._multiReturn, this, options, aIds, callback));
      } else {
        this._generalReturnObject("passed-empty", callback, [], options.type);
      }
    };

    Datamodel.prototype.getRel = function(id, relation, callback, options) {
      var oRelation;
      options = _.extend({
        type: "getrel"
      }, this.defaultGetOptions, options);
      oRelation = this._getRelation(relation);
      if (oRelation) {
        oRelation.get(id, callback);
      } else {
        this._generalReturnObject("relation-notfound", callback, {
          id: id,
          relation: relation
        }, options.type);
      }
    };

    Datamodel.prototype.has = function(id, callback, options) {
      var filter;
      options = _.extend({
        type: "has"
      }, this.defaultGetOptions, options);
      filter = {};
      filter[this.sIdField] = id;
      this.count(filter, callback, options);
    };

    Datamodel.prototype.count = function(filter, callback, options) {
      var filterReturn, sStatement;
      options = _.extend({
        type: "count",
        _customQueryEnd: ""
      }, this.defaultGetOptions, options);
      filter || (filter = {});
      filterReturn = this._generateFilter(filter);
      sStatement = "SELECT COUNT( " + this.sIdField + " ) AS count FROM " + this.tablename + " " + filterReturn.filter + " " + options._customQueryEnd;
      this.connector.query(sStatement, filterReturn.args, _.bind(this._countReturn, this, options, filter, callback));
    };

    Datamodel.prototype.find = function(filter, callback, options) {
      var filterReturn, sStatement;
      options = _.extend({
        type: "find",
        _customQueryEnd: ""
      }, this.defaultGetOptions, options);
      if (options._customQueryFilter != null) {
        filterReturn = options._customQueryFilter(filter);
      } else {
        filterReturn = this._generateFilter(filter);
      }
      sStatement = options._customQueryFind || ("SELECT " + (this._getFields(options.fields).join(", ")) + " FROM " + this.tablename + " " + filterReturn.filter + " " + (this._getSorting(options)) + " " + (this._getLimiterStatement(filter)) + " " + options._customQueryEnd);
      this.connector.query(sStatement, filterReturn.args, _.bind(this._multiReturn, this, options, filter, callback));
    };

    Datamodel.prototype.search = function(term, filter, callback, options) {
      var filterReturn, filterReturnSearch, sStatement;
      options = _.extend({
        type: "search",
        _customQueryEnd: ""
      }, this.defaultGetOptions, options);
      filter || (filter = {});
      filterReturn = this._generateFilter(filter);
      filterReturnSearch = this._generateSearchFilter(term, filterReturn.args, !filterReturn.filter.length);
      sStatement = "SELECT " + (this._getFields(options.fields).join(", ")) + " FROM " + this.tablename + " ";
      if (filterReturn.filter.length) {
        sStatement += filterReturn.filter;
        sStatement += " AND ( 1=0 ";
      }
      sStatement += filterReturnSearch.filter;
      if (filterReturn.filter.length) {
        sStatement += " )";
      }
      if (options._customQueryEnd.length) {
        sStatement += " " + (this._getSorting(options)) + " " + (this._getLimiterStatement(filter)) + " " + options._customQueryEnd;
      }
      this.connector.query(sStatement, filterReturnSearch.args, _.bind(this._multiReturn, this, options, term, callback));
    };

    Datamodel.prototype.set = function(id, data, callback, options) {
      var aRelationKeys, args, filter, isUpdate,
        _this = this;
      filter = {};
      args = [];
      aRelationKeys = this._getRelationKeys();
      isUpdate = false;
      if (arguments.length === 2) {
        callback = data;
        data = id;
        id = null;
        options = {};
      } else if (arguments.length === 3 && (_.isString(callback) || _.isFunction(callback))) {
        options = {};
        isUpdate = true;
      } else if (arguments.length === 3 && (_[this.hasStringId ? "isString" : "isNumber"](id))) {
        isUpdate = true;
      } else if (arguments.length === 3) {
        isUpdate = false;
        options = callback;
        callback = data;
        data = id;
        id = null;
      } else if (arguments.length === 4 && id) {
        isUpdate = true;
      }
      options = _.extend({
        type: "set"
      }, this.defaultGetOptions, options);
      this.validate(isUpdate, id, data, callback, options, function(data) {
        var dataReturn, filterReturn, fnInsert, sStatement;
        if (isUpdate) {
          dataReturn = _this._generateSetOrUpdate(false, data, args);
          args = dataReturn.args;
          if (_.isNumber(id) || _.isString(id)) {
            filter[_this.sIdField] = id;
          } else {
            filter = id;
          }
          filterReturn = _this._generateFilter(filter, args);
          args = filterReturn.args;
          sStatement = options._customQueryUpdate || ("UPDATE " + _this.tablename + " " + dataReturn.statement + " " + filterReturn.filter);
          return _this.connector.query(sStatement, args, _.bind(_this._setReturn, _this, options, filter, callback));
        } else {
          fnInsert = function(data) {
            var aDataKeys, aRelDataKeys, fnSeriesCall, fnSet, idKey, idx, relkey, _i, _len;
            aDataKeys = _.keys(data);
            aRelDataKeys = _.intersection(aRelationKeys, aDataKeys);
            if (_.isArray(_this.sIdField)) {
              for (idKey in _this.sIdField) {
                if (filter[idKey] = data[idKey]) {
                  filter[idKey] = data[idKey];
                }
              }
            } else if (data[_this.sIdField]) {
              filter[_this.sIdField] = data[_this.sIdField];
            }
            dataReturn = _this._generateSetOrUpdate(true, _.reduce(data, function(memo, obj, key) {
              if (_.indexOf(aRelDataKeys, key) < 0) {
                memo[key] = obj;
              }
              return memo;
            }, {}));
            sStatement = ("INSERT INTO " + _this.tablename) + dataReturn.statement;
            args = dataReturn.args;
            if (aRelDataKeys.length) {
              fnSeriesCall = {};
              fnSeriesCall[_this.tablename] = function(cb) {
                return _this.connector.query(sStatement, args, _.bind(_this._setReturn, _this, options, filter, function(err, res) {
                  return cb(err, res);
                }));
              };
              for (idx = _i = 0, _len = aRelDataKeys.length; _i < _len; idx = ++_i) {
                relkey = aRelDataKeys[idx];
                if (_this._hasRelation(relkey)) {
                  fnSet = _this._getRelation(relkey).set;
                  if (fnSet) {
                    fnSeriesCall[relkey] = function(cb) {
                      return fnSet(id[_this.sIdField], data[relkey], function(err, res) {
                        return cb(err, res);
                      });
                    };
                  }
                }
              }
              return async.series(fnSeriesCall, function(err, res) {
                var oReturn;
                oReturn = {};
                if (!err) {
                  oReturn = res[_this.tablename];
                  delete res[_this.tablename];
                  return callback(err, _.extend(oReturn, _.reduce(res, function(memo, obj, key) {
                    if (key !== this.tablename) {
                      memo[key] = obj;
                    }
                    return memo;
                  }, _this)));
                } else {
                  return callback(err, res);
                }
              });
            } else {
              return _this.connector.query(sStatement, args, _.bind(_this._setReturn, _this, options, filter, callback));
            }
          };
          if (_this.hasStringId) {
            return _this._generateNewID(data[_this.sIdField], function(newId) {
              data[_this.sIdField] = newId;
              filter[_this.sIdField] = newId;
              return fnInsert(data);
            });
          } else {
            return fnInsert(data);
          }
        }
      });
    };

    Datamodel.prototype.del = function(id, callback, options) {
      var _this = this;
      if (_.isNumber(id) || _.isString(id)) {
        id = {
          id: id
        };
      }
      options = _.extend({
        type: "del",
        useValidation: false
      }, this.defaultGetOptions, options);
      this.get(id.id, function(err, res) {
        if (!err) {
          options.data2del = [res];
          _this.mdel(id, callback, options);
        } else {
          _this._generalReturnObject("notfound", callback, res, options.type);
        }
      });
    };

    Datamodel.prototype.mdel = function(filter, callback, options) {
      var filterSave, fnDel,
        _this = this;
      options = _.extend({
        type: "mdel",
        data2del: null,
        useValidation: true
      }, this.defaultGetOptions, options);
      filter || (filter = {});
      filterSave = utils.extend(true, {}, filter);
      fnDel = function(filter, callback, options) {
        var fnQueuryDel, oFilter, validation;
        if (filter) {
          fnQueuryDel = function(oFilter) {
            var filterReturn, sStatement;
            if (options._customQueryFilter != null) {
              filterReturn = options._customQueryFilter(filter);
            } else {
              filterReturn = _this._generateFilter(filter);
            }
            sStatement = "DELETE FROM " + _this.tablename + " " + filterReturn.filter;
            return _this.connector.query(sStatement, filterReturn.args, _.bind(_this._delReturn, _this, options, oFilter, callback));
          };
          oFilter = {};
          if (_.isArray(filter)) {
            if (filter.length > 1) {
              oFilter[_this.sIdField] = filter;
            } else if (filter.length === 1) {
              oFilter[_this.sIdField] = filter[0];
            }
          } else if (_.isString(filter) || _.isNumber(filter) || _.isBoolean(filter)) {
            oFilter[_this.sIdField] = filter;
          } else {
            oFilter = filter;
          }
          if (oFilter.id !== void 0 && _this._hasField(_timestampField)) {
            if (options.useValidation) {
              validation = _this._validateField(_this._getField(_timestampField), oFilter[_timestampField], options.data2del[0][_timestampField], true, oFilter.id, options, callback);
            }
            if (!options.useValidation || validation.success) {
              fnQueuryDel(oFilter);
            } else {
              return;
            }
          } else {
            fnQueuryDel(oFilter);
            if (oFilter.id === void 0) {
              console.log("!WARNING! DELETE without id!", filter, options.data2del);
            }
          }
        } else {
          _this._generalReturnObject("passed-empty", callback, [], options.type);
        }
      };
      if (!options.data2del) {
        this.find(filter, function(err, res) {
          if (!err && res.length) {
            options.data2del = res;
            fnDel(filterSave, callback, options);
          } else if (!err) {
            _this._generalReturnObject("notfound", callback, res, options.type);
          } else {
            callback(err, res);
          }
        });
      } else {
        fnDel(filter, callback, options);
      }
    };

    Datamodel.prototype.increment = function(id, column, callback, options) {
      options = _.extend({
        type: "increment"
      }, this.defaultGetOptions, options);
      this._crement(id, column, 1, callback, options);
    };

    Datamodel.prototype.decrement = function(id, column, callback, options) {
      options = _.extend({
        type: "increment"
      }, this.defaultGetOptions, options);
      this._crement(id, column, -1, callback, options);
    };

    Datamodel.prototype._crement = function(id, column, value, callback, options) {
      var field, filter, filterReturn, sStatement,
        _this = this;
      options = _.extend({
        type: "_crement"
      }, this.defaultGetOptions, options);
      options.column = column;
      filter = {};
      if (id) {
        filter[this.sIdField] = id;
      }
      filterReturn = this._generateFilter(filter);
      value = parseInt(value, 10);
      if (!_.isNumber(value)) {
        this._generalReturnObject("not-a-numbervalue", callback, [], options.type);
      }
      field = this._getField(column);
      if (field && field.type === "number") {
        sStatement = "UPDATE " + this.tablename + " SET " + column + " = " + column + " + " + value + " " + filterReturn.filter;
        this.connector.query(sStatement, filterReturn.args, function(err, res) {
          if (!err) {
            filterReturn = _this._generateFilter(filter);
            sStatement = "SELECT " + column + " AS count FROM " + _this.tablename + " " + filterReturn.filter;
            _this.connector.query(sStatement, filterReturn.args, _.bind(_this._countReturn, _this, options, filter, callback));
          } else {
            _this._generalReturnObject("sql-error", callback, [], options.type);
          }
        });
      } else {
        this._generalReturnObject("not-a-numberfield", callback, [], options.type);
      }
    };

    Datamodel.prototype.validate = function(isUpdate, id, data, callback, options, fn) {
      var fnValidate, useGet,
        _this = this;
      fnValidate = function(oldData) {
        var aCheckFns, aErrors, field, fieldname, _ref;
        if (oldData == null) {
          oldData = {};
        }
        aErrors = [];
        aCheckFns = [];
        _ref = _this.fields;
        for (fieldname in _ref) {
          field = _ref[fieldname];
          aCheckFns.push(_.bind(_this._validateField, _this, field, (data && data[fieldname] !== void 0 ? data[fieldname] : null), (isUpdate && oldData && oldData[fieldname] !== void 0 ? oldData[fieldname] : null), isUpdate, id, options));
        }
        async.parallel(aCheckFns, function(err, validations) {
          var error, validation, _err, _i, _len;
          for (_i = 0, _len = validations.length; _i < _len; _i++) {
            validation = validations[_i];
            if (!(validation !== null)) {
              continue;
            }
            if (validation.value !== null) {
              data[validation.field.name] = validation.value;
            }
            if (!validation.success) {
              aErrors.push(validation);
            }
          }
          if (aErrors.length) {
            error = _.first(aErrors);
            _err = {
              message: "this value already exists",
              field: error.field.name,
              data: error,
              success: false
            };
            _this._generalReturnObject(error.type, callback, _err, null);
          } else {
            fn(data);
          }
        });
      };
      if (isUpdate && id) {
        useGet = _.isNumber(id) || _.isString(id);
        this[useGet ? "get" : "find"](id, function(err, res) {
          if (!err) {
            return fnValidate(useGet ? res : res[0]);
          } else {
            return _this._generalReturnObject("notfound", callback, res, options.type);
          }
        });
      } else {
        fnValidate(null);
      }
    };

    Datamodel.prototype._validateField = function(field, value, oldValue, isUpdate, id, options, cba) {
      var asyncCheck, asyncChecks, error, fnA, rule, rulename, salt, _i, _len, _m, _ref,
        _this = this;
      try {
        switch (field.type) {
          case "string":
            if (value !== null && !_.isString(value)) {
              value = value.toString();
            }
            break;
          case "boolean":
            if (value !== null) {
              if (value === false || value < 1 || value.length < 1) {
                value = false;
              } else {
                value = true;
              }
            }
            break;
          case "number":
            if (value !== null && !_.isEmpty(value) && !_.isNumber(value)) {
              value = parseInt(value, 10);
            }
            break;
          case "timestamp":
            if (value !== null && !_.isEmpty(value) && !_.isNumber(value)) {
              value = parseInt(value, 10);
            }
            break;
          case "date":
            if (_.isDate(value)) {
              value = value.toISOString();
            } else if (_.isDate((_m = moment(value, ["YYYY-MM-DD", "DD.MM.YYYY", "YYYY-MM-DD HH:mm"]))._d)) {
              value = _m.format("YYYY-MM-DD HH:mm");
            }
            break;
          case "json":
            if ((value != null) && !(_.isString(value) || _.isNumber(value) || _.isBoolean(value))) {
              try {
                value = JSON.stringify(value);
              } catch (_error) {
                error = _error;
                cba(null, {
                  value: value,
                  success: false,
                  field: field,
                  type: "validation-jsonerror"
                });
                return;
              }
            }
        }
      } catch (_error) {
        error = _error;
      }
      asyncChecks = [];
      _ref = field.validation;
      for (rulename in _ref) {
        rule = _ref[rulename];
        if (rulename === "isRequired" && rule && value === void 0) {
          cba(null, {
            value: value,
            success: false,
            field: field,
            type: "validation-required"
          });
          return;
        }
        if (!(options != null ? options.equalOldValueIgnore : void 0)) {
          if (rulename === "equalOldValue" && rule && isUpdate && value !== oldValue) {
            cba(null, {
              value: value,
              success: false,
              field: field,
              type: "validation-notequal"
            });
            return;
          }
        }
        if (rulename === "bcrypt" && rule && value) {
          salt = bcrypt.genSaltSync(rule.rounds || 8);
          value = bcrypt.hashSync(value, salt);
        }
        if (rulename === "setTimestamp" && rule) {
          value = "UNIX_TIMESTAMP()*1000";
        }
        if (rulename === "allreadyExistend" && rule && value && value !== oldValue) {
          if ((options != null ? options.allreadyExistendNoCase : void 0) == null) {
            asyncChecks.push("allreadyExistend");
          } else if ((value != null ? value.toLowerCase() : void 0) !== (oldValue != null ? oldValue.toLowerCase() : void 0)) {
            asyncChecks.push("allreadyExistend");
          }
        }
        if (rulename === "notAllowedForValue" && rule && value && value !== oldValue && value === rule) {
          cba(null, {
            value: value,
            success: false,
            field: field,
            type: "value-not-allowed"
          });
          return;
        }
        if (rulename === "fireEventOnChange" && rule && value !== oldValue) {
          this.emit(field.name + "." + rule, oldValue, value, id);
        } else if (rulename === "incrementOnSave" && rule) {
          if (_.isNumber(oldValue)) {
            value = ++oldValue;
          } else {
            value = 0;
          }
        }
      }
      if (asyncChecks.length) {
        fnA = [];
        for (_i = 0, _len = asyncChecks.length; _i < _len; _i++) {
          asyncCheck = asyncChecks[_i];
          switch (asyncCheck) {
            case "allreadyExistend":
              fnA.push(_.bind(function(value, field, cba) {
                var _filter,
                  _this = this;
                _filter = {};
                _filter[field.name] = value;
                this.count(_filter, function(err, cRet) {
                  if (err) {
                    cba(err);
                  } else if (cRet.count > 0) {
                    cba({
                      value: value,
                      success: false,
                      field: field,
                      type: "validation-already-existend"
                    });
                  } else {
                    cba(null);
                  }
                });
              }, this, value, field));
          }
        }
        async.parallel(fnA, function(err) {
          if (err) {
            cba(null, err);
          } else {
            cba(null, {
              value: value,
              success: true,
              field: field
            });
          }
        });
      } else {
        cba(null, {
          value: value,
          success: true,
          field: field
        });
      }
    };

    Datamodel.prototype._initFields = function() {
      var field, fieldname, fieldsetname, relModel, relModelBase, relation, relfield, relfieldname, _i, _len, _ref, _ref1, _ref2, _results,
        _this = this;
      if (this.useFieldsets) {
        this.fieldsets = {};
        _ref = this.fields;
        for (fieldname in _ref) {
          field = _ref[fieldname];
          if (field.fieldsets) {
            _ref1 = field.fieldsets;
            for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
              fieldsetname = _ref1[_i];
              if (this.fieldsets[fieldsetname] == null) {
                this.fieldsets[fieldsetname] = [];
              }
              this.fieldsets[fieldsetname].push(fieldname);
            }
          }
        }
      } else {
        this.fieldsets = null;
      }
      _ref2 = this.relations;
      _results = [];
      for (fieldname in _ref2) {
        relation = _ref2[fieldname];
        relModel = null;
        relation.get = null;
        relation.set = null;
        switch (relation.type) {
          case "rel_1":
            relModel = this.factory.get(relation.relModel);
            _results.push(relation.get = function(id, callback) {
              return _this.get(id, function(err, res) {
                if (!err) {
                  return relModel.get(res[relation.field], callback);
                }
              });
            });
            break;
          case "rel_n":
            relModel = this.factory.get(relation.relModel);
            _results.push(relation.get = function(id, callback) {
              var forignRel, oFilter;
              forignRel = relModel._getRelation(relation.relation);
              oFilter = {};
              oFilter[forignRel.field] = id;
              return relModel.find(oFilter, callback);
            });
            break;
          case "rel_nm":
            relModelBase = this.factory.get(relation.relModel);
            _results.push((function() {
              var _ref3, _results1,
                _this = this;
              _ref3 = relModelBase.settings.fields;
              _results1 = [];
              for (relfieldname in _ref3) {
                relfield = _ref3[relfieldname];
                if (relation.foreignfield === relfieldname) {
                  relModel = this.factory.get(relfield.relModel);
                  relation.get = function(id, callback) {
                    var oFilter;
                    oFilter = {};
                    oFilter[relfieldname] = {};
                    oFilter[relfieldname].val = id;
                    oFilter[relfieldname].reltable = relModelBase.settings.tablename;
                    oFilter[relfieldname].foreignfield = relfield.foreignfield;
                    relModel.find(oFilter, callback);
                  };
                  _results1.push(relation.set = _.bind(function(id, aData, callback) {
                    var aSetfn, data, idx, val, _j, _len1,
                      _this = this;
                    aSetfn = [];
                    for (idx = _j = 0, _len1 = aData.length; _j < _len1; idx = ++_j) {
                      val = aData[idx];
                      data = {};
                      data[relfieldname] = val;
                      data[relfield.foreignfield] = id;
                      aSetfn.push(function(cb) {
                        relModelBase.set(data, function(err, res) {
                          cb(err, res);
                        });
                      });
                    }
                    async.parallel(aSetfn, callback);
                    return;
                    return this;
                  }));
                } else {
                  _results1.push(void 0);
                }
              }
              return _results1;
            }).call(this));
            break;
          default:
            _results.push(void 0);
        }
      }
      return _results;
    };

    Datamodel.prototype._loadIDs = function() {
      var _this = this;
      if (this.cachekey) {
        return this.find({}, function(err, aData) {
          var data, redMulti, _i, _len;
          if (!err) {
            redMulti = [];
            for (_i = 0, _len = aData.length; _i < _len; _i++) {
              data = aData[_i];
              redMulti.push(["set", _this.cachekey + data[_this.sIdField], JSON.stringify(data)]);
            }
            _this.redis.multi(redMulti).exec();
          }
        });
      }
    };

    Datamodel.prototype._generateNewID = function(id, callback) {
      var sId,
        _this = this;
      if (arguments.length <= 1) {
        callback = id;
        id = null;
      }
      if (id) {
        sId = id;
      } else {
        if ((this.settings.createIdString != null) && _.isFunction(this.settings.createIdString)) {
          sId = this.settings.createIdString();
        } else {
          sId = utils.randomString(5);
        }
      }
      this.has(sId, function(err, res) {
        if (!err && !res) {
          return callback(sId);
        } else {
          return _this._generateNewID(callback);
        }
      });
    };

    Datamodel.prototype._singleReturn = function(options, id, callback, err, result, meta) {
      if (!err) {
        result = result.length ? result[0] : null;
        result = this._postProcess(result);
        result = this._generateReturnObject((result === null ? "notfound" : 0), result);
        if (this.cachekey && result.success && options.fields === "all") {
          if (_.isString(id) || _.isNumber(id)) {
            this.redis.set(this.cachekey + id, JSON.stringify(result.data));
          } else if (id[this.sIdField]) {
            this.redis.set(this.cachekey + id[this.sIdField], JSON.stringify(result.data));
          }
        }
        this._generalReturn(callback, result, options.type);
      } else {
        this._generalReturnObject('sql-error', callback, err, options.type);
      }
    };

    Datamodel.prototype._multiReturn = function(options, id, callback, err, result, meta) {
      var idx, resHelp, val, _i, _j, _k, _len, _len1, _len2;
      if (!err) {
        for (idx = _i = 0, _len = result.length; _i < _len; idx = ++_i) {
          val = result[idx];
          val = this._postProcess(val);
        }
        if (this.cachekey && result && result.length && options.fields === "all") {
          for (idx = _j = 0, _len1 = result.length; _j < _len1; idx = ++_j) {
            val = result[idx];
            this.redis.set(this.cachekey + val[this.sIdField], JSON.stringify(val));
          }
        }
        if (result !== null && options.fields === "idonly") {
          resHelp = [];
          for (_k = 0, _len2 = result.length; _k < _len2; _k++) {
            val = result[_k];
            resHelp.push(val[this.sIdField]);
          }
          result = resHelp;
        }
        result = this._generateReturnObject((result === null ? "notfound" : 0), result);
        this._generalReturn(callback, result, options.type);
      } else {
        this._generalReturnObject('sql-error', callback, err, options.type);
      }
    };

    Datamodel.prototype._countReturn = function(options, id, callback, err, result, meta) {
      var _ref;
      if (!err) {
        if (options.type === "has") {
          if (result && result.length && result[0].count > 0) {
            result = true;
          } else {
            result = false;
          }
        } else {
          if (result && result.length && result[0].count !== void 0) {
            result = result[0];
          } else {
            result = {
              count: 0
            };
          }
          if (_.string.include(options.type, "crement")) {
            result = {
              version: result.count,
              column: options.column,
              id: id.id
            };
          }
        }
        result = this._generateReturnObject((_ref = result === null) != null ? _ref : {
          "notfound": 0
        }, result);
        this._generalReturn(callback, result, options.type);
      } else {
        this._generalReturnObject('sql-error', callback, err, options.type);
      }
    };

    Datamodel.prototype._setReturn = function(options, filter, callback, err, result, meta) {
      if (!err) {
        if (meta.insertId) {
          this.get(meta.insertId, callback, {
            type: options.type,
            fields: "all",
            forceDBload: true
          });
        } else if (meta.affectedRows >= 1 && (_.isArray(this.sIdField) ? filter : filter[this.sIdField])) {
          this.get((_.isArray(this.sIdField) ? filter : filter[this.sIdField]), callback, {
            type: options.type,
            fields: "all",
            forceDBload: true
          });
        } else {
          if (meta.affectedRows >= 1) {
            this.find(filter, callback, {
              type: options.type,
              fields: "all"
            });
          } else {
            result = this._generateReturnObject("notfound", result);
            this._generalReturn(callback, result, options.type);
          }
        }
      } else {
        this._generalReturnObject('sql-error', callback, err, options.type);
      }
    };

    Datamodel.prototype._delReturn = function(options, filter, callback, err, result, meta) {
      var args, sId, _i, _len, _ref;
      if (!err) {
        if (meta.affectedRows >= 1) {
          args = [];
          if (_.isArray(filter[this.sIdField])) {
            _ref = filter[this.sIdField];
            for (_i = 0, _len = _ref.length; _i < _len; _i++) {
              sId = _ref[_i];
              args.push(this.cachekey + sId.replace(/"/g, ""));
            }
          } else {
            args.push(this.cachekey + filter[this.sIdField]);
          }
          this.redis.del.apply(this.redis, args);
          this._generalReturnObject(0, callback, options.data2del, options.type);
        } else {
          this._generalReturnObject("notfound", callback, result, options.type);
        }
      } else {
        this._generalReturnObject('sql-error', callback, err, options.type);
      }
    };

    Datamodel.prototype._generalReturn = function(callback, result, type) {
      var err, _ref;
      err = null;
      if (!result.success) {
        err = {
          errorcode: result.errorcode,
          msg: result.msg,
          data: result.data
        };
        if (((_ref = result.data) != null ? _ref.field : void 0) != null) {
          err.field = result.data.field;
        }
      }
      if (_.isFunction(callback)) {
        callback(err, result.data);
      } else if (_.isString(callback)) {
        this.emit(type + "." + callback, err, result);
      }
      this.emit(type, err, result);
    };

    Datamodel.prototype._generateReturnObject = function(errorcode, result) {
      var oReturn;
      oReturn = {};
      if (errorcode) {
        oReturn = {
          success: false,
          errorcode: errorcode,
          msg: this.ERRORS[errorcode] || (result && result['message'] ? result['message'] : result),
          data: result === void 0 ? null : result
        };
      } else {
        oReturn = {
          success: true,
          errorcode: null,
          msg: null,
          data: result
        };
      }
      return oReturn;
    };

    Datamodel.prototype._generalReturnObject = function(errorcode, callback, result, type) {
      return this._generalReturn(callback, this._generateReturnObject(errorcode, result), type);
    };

    Datamodel.prototype._postProcess = function(result) {
      var field, fieldname, resultEl, _i, _len, _ref;
      if (_.isArray(result)) {
        for (_i = 0, _len = result.length; _i < _len; _i++) {
          resultEl = result[_i];
          this._postProcess(resultEl);
        }
      } else {
        _ref = this.fields;
        for (fieldname in _ref) {
          field = _ref[fieldname];
          if (result && result[fieldname]) {
            result[fieldname] = this._postProcessField(field, result[fieldname]);
          }
        }
      }
      return result;
    };

    Datamodel.prototype._postProcessField = function(field, value) {
      var error;
      try {
        switch (field.type) {
          case "string":
            if (value !== null && !_.isString(value)) {
              value = value.toString();
            }
            break;
          case "boolean":
            if (value === false || value < 1 || value.length < 1) {
              value = false;
            } else {
              value = true;
            }
            break;
          case "number":
            if (value !== null && !_.isNumber(value)) {
              value = parseInt(value, 10);
            }
            break;
          case "timestamp":
            if (value !== null && !_.isNumber(value)) {
              value = parseInt(value, 10);
            }
            break;
          case "json":
            if (value !== null && (_.isString(value) || _.isNumber(value) || _.isBoolean(value))) {
              value = JSON.parse(value);
            }
        }
      } catch (_error) {
        error = _error;
        console.log("Convert Error", error);
      }
      return value;
    };

    Datamodel.prototype._generateFilter = function(filter, args) {
      var field, isFirstWhere, oReturn, val;
      if (args == null) {
        args = [];
      }
      oReturn = {
        filter: "",
        args: args
      };
      isFirstWhere = true;
      for (field in filter) {
        val = filter[field];
        if (this._hasField(field)) {
          if (isFirstWhere) {
            oReturn.filter += "WHERE " + field + " ";
            isFirstWhere = false;
          } else {
            oReturn.filter += "AND " + field + " ";
          }
          if (_.isObject(val) && (val.val != null) && (val.operator != null)) {
            oReturn.filter += "" + val.operator + " ? ";
            oReturn.args.push(val.val);
          } else if (_.isArray(val)) {
            oReturn.filter += "IN (?) ";
            oReturn.args.push(val);
          } else if (val && val.reltable !== void 0) {
            oReturn.filter += "IN ( SELECT " + field + " FROM " + val.reltable + " WHERE " + val.foreignfield + " IN (?) ) ";
            oReturn.args.push(val.val);
          } else {
            oReturn.filter += "= ? ";
            oReturn.args.push(val);
          }
        }
      }
      return oReturn;
    };

    Datamodel.prototype._generateSearchFilter = function(term, args, isFirstWhere) {
      var aSearchFields, field, oReturn, _i, _len;
      if (args == null) {
        args = [];
      }
      if (isFirstWhere == null) {
        isFirstWhere = true;
      }
      oReturn = {
        filter: "",
        args: args
      };
      aSearchFields = this._getFields(function(field) {
        return !!field.search;
      });
      for (_i = 0, _len = aSearchFields.length; _i < _len; _i++) {
        field = aSearchFields[_i];
        if (isFirstWhere) {
          oReturn.filter += "WHERE " + field.name + " ";
          isFirstWhere = false;
        } else {
          oReturn.filter += "OR " + field.name + " ";
        }
        oReturn.filter += " LIKE \"%" + term + "%\" ";
      }
      return oReturn;
    };

    Datamodel.prototype._generateSetOrUpdate = function(isCreate, data, args) {
      var field, isFirstSet, oReturn, sFields, sValues, val;
      if (args == null) {
        args = [];
      }
      oReturn = {
        statement: "",
        args: args
      };
      isFirstSet = true;
      sFields = "";
      sValues = "";
      if (isCreate) {
        oReturn.statement = "";
      } else {
        oReturn.statement = " SET ";
      }
      for (field in data) {
        val = data[field];
        if (this._hasField(field) && !(field === this.sIdField && !(this.hasStringId && isCreate))) {
          if (isFirstSet) {
            isFirstSet = false;
          } else {
            if (isCreate) {
              sFields += ", ";
              sValues += ", ";
            } else {
              oReturn.statement += ", ";
            }
          }
          if (isCreate) {
            sFields += field;
            sValues += "?";
          } else {
            oReturn.statement += field + " = ? ";
          }
          oReturn.args.push(val);
        }
      }
      if (isCreate) {
        oReturn.statement += "(" + sFields + ") " + "VALUES (" + sValues + ") ";
      }
      return oReturn;
    };

    Datamodel.prototype._getRelationKeys = function() {
      return _.keys(this.relations);
    };

    Datamodel.prototype._getRelation = function(relation) {
      return this.relations[relation] || null;
    };

    Datamodel.prototype._hasRelation = function(relation) {
      if (this.relations[relation]) {
        return true;
      } else {
        return false;
      }
    };

    Datamodel.prototype._getFields = function(fnFilter) {
      var setName;
      if (fnFilter == null) {
        fnFilter = "all";
      }
      if (fnFilter && _.isFunction(fnFilter)) {
        return _.pluck(_.filter(this.fields, fnFilter), "name");
      } else {
        if (this.useFieldsets && _.isString(fnFilter) && _.string.startsWith(fnFilter, "set:")) {
          setName = fnFilter.replace("set:", "");
          if (this.fieldsets[setName] != null) {
            return this.fieldsets[setName];
          } else {
            return [];
          }
        } else if (_.isString(fnFilter) && fnFilter === "all") {
          return _.keys(this.fields);
        } else if (_.isString(fnFilter) && fnFilter === "idonly") {
          return [this.sIdField];
        } else if (_.isArray(fnFilter)) {
          return _.intersection(_.pluck(this.fields, 'name'), fnFilter);
        } else if (_.isString(fnFilter)) {
          return fnFilter.split(',');
        }
      }
    };

    Datamodel.prototype._getField = function(field) {
      return this.fields[field] || null;
    };

    Datamodel.prototype._hasField = function(field) {
      if (this.fields[field]) {
        return true;
      } else {
        return false;
      }
    };

    Datamodel.prototype._reduceSortFields = function(sortfield) {
      var _sF;
      if (sortfield != null) {
        _sF = (sortfield != null) && _.isArray(sortfield) ? sortfield : sortfield.split(",");
      } else {
        _sF = this.sortfield;
      }
      return _.intersection(_sF, this._getFields());
    };

    Datamodel.prototype._getSorting = function(options) {
      var dir, field;
      field = null;
      dir = this.sortdirection || "ASC";
      if ((options.sortdirection != null) && _.include(['ASC', 'DESC'], options.sortdirection.toUpperCase())) {
        dir = options.sortdirection.toUpperCase();
      }
      field = this._reduceSortFields(options.sortfield);
      if (field != null ? field.length : void 0) {
        return "ORDER BY " + (field.join(", ")) + " " + dir;
      } else {
        return "";
      }
    };

    Datamodel.prototype._getLimiterStatement = function(options) {
      var limit, offset, params;
      limit = options.limit || null;
      offset = options.offset || null;
      params = [];
      if (offset) {
        params.push(offset);
      }
      if (limit) {
        params.push(limit);
      } else {
        "";
      }
      if (params.length) {
        return "LIMIT " + (params.join(", "));
      } else {
        return "";
      }
    };

    Datamodel.prototype.ERRORS = {
      "notfound": "Dataset not found",
      "relation-notfound": "Relation not found or defined",
      "passed-empty": "You have passed a empty data",
      "not-a-numberfield": "The passed column is not defined or not type of number"
    };

    return Datamodel;

  })(EventEmitter);

  exports.Datamodel = Datamodel;

}).call(this);