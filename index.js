/*
MIT License

Copyright (c) 2017 Edouard HINVI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
var EventEmitter, RedisInstance, IoRedisSessions, _,
  bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

_ = require("lodash");

RedisInstance = require("ioredis");

EventEmitter = require("events").EventEmitter;

IoRedisSessions = (function(superClass) {
  extend(IoRedisSessions, superClass);

  function IoRedisSessions(o) {
    var ref, ref1, wipe;
    if (o == null) {
      o = {};
    }
    this._wipe = bind(this._wipe, this);
    this._returnSessions = bind(this._returnSessions, this);
    this._initErrors = bind(this._initErrors, this);
    this._handleError = bind(this._handleError, this);
    this.soid = bind(this.soid, this);
    this.soapp = bind(this.soapp, this);
    this.set = bind(this.set, this);
    this.quit = bind(this.quit, this);
    this.ping = bind(this.ping, this);
    this.killsoid = bind(this.killsoid, this);
    this.killall = bind(this.killall, this);
    this._kill = bind(this._kill, this);
    this.kill = bind(this.kill, this);
    this.get = bind(this.get, this);
    this.create = bind(this.create, this);
    this.activity = bind(this.activity, this);
    this._initErrors();
    this.redisns = o.namespace || "rs";
    this.redisns = this.redisns + ":";
    if (((ref = o.client) != null ? (ref1 = ref.constructor) != null ? ref1.name : void 0 : void 0) === "RedisClient") {
      this.redis = o.client;
    } else if (o.options && o.options.url) {
      this.redis = new RedisInstance(o.options);
    } else if (o.sentinels && o.name) {
      this.redis = new RedisInstance({
        sentinels: o.sentinels,
        name: o.name,
        options: o.options
      });
    } else {
      this.redis = new RedisInstance(o.port || 6379, o.host || "127.0.0.1", o.options || {});
    }
    this.connected = this.redis.connected || false;
    this.redis.on("connect", (function(_this) {
      return function() {
        _this.connected = true;
        _this.emit("connect");
      };
    })(this));
    this.redis.on("error", (function(_this) {
      return function(err) {
        if (err.message.indexOf("ECONNREFUSED")) {
          _this.connected = false;
          _this.emit("disconnect");
        } else {
          console.error("Redis ERROR", err);
          _this.emit("error");
        }
      };
    })(this));
    if (o.wipe !== 0) {
      wipe = o.wipe || 600;
      if (wipe < 10) {
        wipe = 10;
      }
      setInterval(this._wipe, wipe * 1000);
    }
  }

  IoRedisSessions.prototype.activity = function(options, cb) {
    if (this._validate(options, ["app", "dt"], cb) === false) {
      return;
    }
    this.redis.zcount("" + this.redisns + options.app + ":_users", this._now() - options.dt, "+inf", function(err, resp) {
      if (err) {
        cb(err);
        return;
      }
      cb(null, {
        activity: resp
      });
    });
  };

  IoRedisSessions.prototype.create = function(options, cb) {
    var e, mc, nullkeys, thesession, token;
    options.d = options.d || {
      ___duMmYkEy: null
    };
    options = this._validate(options, ["app", "id", "ip", "ttl", "d"], cb);
    if (options === false) {
      return;
    }
    token = this._createToken();
    mc = this._createMultiStatement(options.app, token, options.id, options.ttl);
    mc.push(["sadd", "" + this.redisns + options.app + ":us:" + options.id, token]);
    thesession = ["hmset", "" + this.redisns + options.app + ":" + token, "id", options.id, "r", 1, "w", 1, "ip", options.ip, "la", this._now(), "ttl", parseInt(options.ttl)];
    if (options.d) {
      nullkeys = [];
      for (e in options.d) {
        if (options.d[e] === null) {
          nullkeys.push(e);
        }
      }
      options.d = _.omit(options.d, nullkeys);
      if (_.keys(options.d).length) {
        thesession = thesession.concat(["d", JSON.stringify(options.d)]);
      }
    }
    mc.push(thesession);
    this.redis.multi(mc).exec(function(err, resp) {
      if (err) {
        cb(err);
        return;
      }
      if (resp[4] !== "OK") {
        cb("Unknow error");
        return;
      }
      cb(null, {
        token: token
      });
    });
  };

  IoRedisSessions.prototype.get = function(options, cb) {
    var now, thekey;
    options = this._validate(options, ["app", "token"], cb);
    if (options === false) {
      return;
    }
    now = this._now();
    thekey = "" + this.redisns + options.app + ":" + options.token;
    this.redis.hmget(thekey, "id", "r", "w", "ttl", "d", "la", "ip", (function(_this) {
      return function(err, resp) {
        var mc, o;
        if (err) {
          cb(err);
          return;
        }
        o = _this._prepareSession(resp);
        if (o === null) {
          cb(null, {});
          return;
        }
        if (options._noupdate) {
          cb(null, o);
          return;
        }
        mc = _this._createMultiStatement(options.app, options.token, o.id, o.ttl);
        mc.push(["hincrby", thekey, "r", 1]);
        if (o.idle > 1) {
          mc.push(["hset", thekey, "la", now]);
        }
        _this.redis.multi(mc).exec(function(err, resp) {
          if (err) {
            cb(err);
            return;
          }
          cb(null, o);
        });
      };
    })(this));
  };

  IoRedisSessions.prototype.kill = function(options, cb) {
    options = this._validate(options, ["app", "token"], cb);
    if (options === false) {
      return;
    }
    options._noupdate = true;
    this.get(options, (function(_this) {
      return function(err, resp) {
        if (err) {
          cb(err);
          return;
        }
        if (!resp.id) {
          cb(null, {
            kill: 0
          });
          return;
        }
        options.id = resp.id;
        _this._kill(options, cb);
      };
    })(this));
  };

  IoRedisSessions.prototype._kill = function(options, cb) {
    var mc;
    mc = [["zrem", "" + this.redisns + options.app + ":_sessions", options.token + ":" + options.id], ["srem", "" + this.redisns + options.app + ":us:" + options.id, options.token], ["zrem", this.redisns + "SESSIONS", options.app + ":" + options.token + ":" + options.id], ["del", "" + this.redisns + options.app + ":" + options.token], ["exists", "" + this.redisns + options.app + ":us:" + options.id]];
    this.redis.multi(mc).exec((function(_this) {
      return function(err, resp) {
        if (err) {
          cb(err);
          return;
        }
        if (resp[4] === 0) {
          _this.redis.zrem("" + _this.redisns + options.app + ":_users", options.id, function() {
            if (err) {
              cb(err);
              return;
            }
            cb(null, {
              kill: resp[3]
            });
          });
        } else {
          cb(null, {
            kill: resp[3]
          });
        }
      };
    })(this));
  };

  IoRedisSessions.prototype.killall = function(options, cb) {
    var appsessionkey, appuserkey;
    options = this._validate(options, ["app"], cb);
    if (options === false) {
      return;
    }
    appsessionkey = "" + this.redisns + options.app + ":_sessions";
    appuserkey = "" + this.redisns + options.app + ":_users";
    this.redis.zrange(appsessionkey, 0, -1, (function(_this) {
      return function(err, resp) {
        var e, globalkeys, j, len, mc, thekey, tokenkeys, userkeys, ussets;
        if (err) {
          cb(err);
          return;
        }
        if (!resp.length) {
          cb(null, {
            kill: 0
          });
          return;
        }
        globalkeys = [];
        tokenkeys = [];
        userkeys = [];
        for (j = 0, len = resp.length; j < len; j++) {
          e = resp[j];
          thekey = e.split(":");
          globalkeys.push(options.app + ":" + e);
          tokenkeys.push("" + _this.redisns + options.app + ":" + thekey[0]);
          userkeys.push(thekey[1]);
        }
        userkeys = _.uniq(userkeys);
        ussets = (function() {
          var k, len1, results;
          results = [];
          for (k = 0, len1 = userkeys.length; k < len1; k++) {
            e = userkeys[k];
            results.push("" + this.redisns + options.app + ":us:" + e);
          }
          return results;
        }).call(_this);
        mc = [["zrem", appsessionkey].concat(resp), ["zrem", appuserkey].concat(userkeys), ["zrem", _this.redisns + "SESSIONS"].concat(globalkeys), ["del"].concat(ussets), ["del"].concat(tokenkeys)];
        _this.redis.multi(mc).exec(function(err, resp) {
          if (err) {
            cb(err);
            return;
          }
          cb(null, {
            kill: resp[0]
          });
        });
      };
    })(this));
  };

  IoRedisSessions.prototype.killsoid = function(options, cb) {
    options = this._validate(options, ["app", "id"], cb);
    if (options === false) {
      return;
    }
    this.redis.smembers("" + this.redisns + options.app + ":us:" + options.id, (function(_this) {
      return function(err, resp) {
        var j, len, mc, token;
        if (err) {
          cb(err);
          return;
        }
        if (!resp.length) {
          cb(null, {
            kill: 0
          });
          return;
        }
        mc = [];
        for (j = 0, len = resp.length; j < len; j++) {
          token = resp[j];
          mc.push(["zrem", "" + _this.redisns + options.app + ":_sessions", token + ":" + options.id]);
          mc.push(["srem", "" + _this.redisns + options.app + ":us:" + options.id, token]);
          mc.push(["zrem", _this.redisns + "SESSIONS", options.app + ":" + token + ":" + options.id]);
          mc.push(["del", "" + _this.redisns + options.app + ":" + token]);
        }
        mc.push(["exists", "" + _this.redisns + options.app + ":us:" + options.id]);
        _this.redis.multi(mc).exec(function(err, resp) {
          var e, k, len1, ref, total;
          if (err) {
            cb(err);
            return;
          }
          total = 0;
          ref = resp.slice(3);
          for (k = 0, len1 = ref.length; k < len1; k += 4) {
            e = ref[k];
            total = total + e;
          }
          if (_.last(resp) === 0) {
            _this.redis.zrem("" + _this.redisns + options.app + ":_users", options.id, function() {
              cb(null, {
                kill: total
              });
            });
          } else {
            cb(null, {
              kill: total
            });
          }
        });
      };
    })(this));
  };

  IoRedisSessions.prototype.ping = function(cb) {
    this.redis.ping(cb);
  };

  IoRedisSessions.prototype.quit = function() {
    this.redis.quit();
  };

  IoRedisSessions.prototype.set = function(options, cb) {
    options = this._validate(options, ["app", "token", "d"], cb);
    if (options === false) {
      return;
    }
    options._noupdate = true;
    this.get(options, (function(_this) {
      return function(err, resp) {
        var e, mc, nullkeys, thekey;
        if (err) {
          cb(err);
          return;
        }
        if (!resp.id) {
          cb(null, {});
          return;
        }
        nullkeys = [];
        for (e in options.d) {
          if (options.d[e] === null) {
            nullkeys.push(e);
          }
        }
        if (resp.d) {
          resp.d = _.extend(_.omit(resp.d, nullkeys), _.omit(options.d, nullkeys));
        } else {
          resp.d = _.omit(options.d, nullkeys);
        }
        thekey = "" + _this.redisns + options.app + ":" + options.token;
        mc = _this._createMultiStatement(options.app, options.token, resp.id, resp.ttl);
        mc.push(["hincrby", thekey, "w", 1]);
        if (resp.idle > 1) {
          mc.push(["hset", thekey, "la", _this._now()]);
        }
        if (_.keys(resp.d).length) {
          mc.push(["hset", thekey, "d", JSON.stringify(resp.d)]);
        } else {
          mc.push(["hdel", thekey, "d"]);
          resp = _.omit(resp, "d");
        }
        _this.redis.multi(mc).exec(function(err, reply) {
          if (err) {
            cb(err);
            return;
          }
          resp.w = reply[3];
          cb(null, resp);
        });
      };
    })(this));
  };

  IoRedisSessions.prototype.soapp = function(options, cb) {
    if (this._validate(options, ["app", "dt"], cb) === false) {
      return;
    }
    this.redis.zrevrangebyscore("" + this.redisns + options.app + ":_sessions", "+inf", this._now() - options.dt, (function(_this) {
      return function(err, resp) {
        var e;
        if (err) {
          cb(err);
          return;
        }
        resp = (function() {
          var j, len, results;
          results = [];
          for (j = 0, len = resp.length; j < len; j++) {
            e = resp[j];
            results.push(e.split(':')[0]);
          }
          return results;
        })();
        _this._returnSessions(options, resp, cb);
      };
    })(this));
  };

  IoRedisSessions.prototype.soid = function(options, cb) {
    options = this._validate(options, ["app", "id"], cb);
    if (options === false) {
      return;
    }
    this.redis.smembers("" + this.redisns + options.app + ":us:" + options.id, (function(_this) {
      return function(err, resp) {
        if (err) {
          cb(err);
          return;
        }
        _this._returnSessions(options, resp, cb);
      };
    })(this));
  };

  IoRedisSessions.prototype._createMultiStatement = function(app, token, id, ttl) {
    var now;
    now = this._now();
    return [["zadd", "" + this.redisns + app + ":_sessions", now, token + ":" + id], ["zadd", "" + this.redisns + app + ":_users", now, id], ["zadd", this.redisns + "SESSIONS", now + ttl, app + ":" + token + ":" + id]];
  };

  IoRedisSessions.prototype._createToken = function() {
    var i, j, possible, t;
    t = "";
    possible = "ABCDEFGHIJKLMNOPQRSTUVWXYabcdefghijklmnopqrstuvwxyz0123456789";
    for (i = j = 0; j < 55; i = ++j) {
      t += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return t + 'Z' + new Date().getTime().toString(36);
  };

  IoRedisSessions.prototype._handleError = function(cb, err, data) {
    var _err, ref;
    if (data == null) {
      data = {};
    }
    if (_.isString(err)) {
      _err = new Error();
      _err.name = err;
      _err.message = ((ref = this._ERRORS) != null ? typeof ref[err] === "function" ? ref[err](data) : void 0 : void 0) || "unkown";
    } else {
      _err = err;
    }
    cb(_err);
  };

  IoRedisSessions.prototype._initErrors = function() {
    var key, msg, ref;
    this._ERRORS = {};
    ref = this.ERRORS;
    for (key in ref) {
      msg = ref[key];
      this._ERRORS[key] = _.template(msg);
    }
  };

  IoRedisSessions.prototype._now = function() {
    return parseInt((new Date()).getTime() / 1000);
  };

  IoRedisSessions.prototype._prepareSession = function(session) {
    var now, o;
    now = this._now();
    if (session[0] === null) {
      return null;
    }
    o = {
      id: session[0],
      r: Number(session[1]),
      w: Number(session[2]),
      ttl: Number(session[3]),
      idle: now - session[5],
      ip: session[6]
    };
    if (o.ttl < o.idle) {
      return null;
    }
    if (session[4]) {
      o.d = JSON.parse(session[4]);
    }
    return o;
  };

  IoRedisSessions.prototype._returnSessions = function(options, sessions, cb) {
    var e, mc;
    if (!sessions.length) {
      cb(null, {
        sessions: []
      });
      return;
    }
    mc = (function() {
      var j, len, results;
      results = [];
      for (j = 0, len = sessions.length; j < len; j++) {
        e = sessions[j];
        results.push(["hmget", "" + this.redisns + options.app + ":" + e, "id", "r", "w", "ttl", "d", "la", "ip"]);
      }
      return results;
    }).call(this);
    this.redis.multi(mc).exec((function(_this) {
      return function(err, resp) {
        var j, len, o, session;
        if (err) {
          cb(err);
          return;
        }
        o = [];
        for (j = 0, len = resp.length; j < len; j++) {
          e = resp[j];
          session = _this._prepareSession(e);
          if (session !== null) {
            o.push(session);
          }
        }
        cb(null, {
          sessions: o
        });
      };
    })(this));
  };

  IoRedisSessions.prototype._VALID = {
    app: /^([a-zA-Z0-9_-]){3,20}$/,
    id: /^(.*?){1,128}$/,
    ip: /^.{1,39}$/,
    token: /^([a-zA-Z0-9]){64}$/
  };

  IoRedisSessions.prototype._validate = function(o, items, cb) {
    var e, item, j, keys, len;
    for (j = 0, len = items.length; j < len; j++) {
      item = items[j];
      switch (item) {
        case "app":
        case "id":
        case "ip":
        case "token":
          if (!o[item]) {
            this._handleError(cb, "missingParameter", {
              item: item
            });
            return false;
          }
          o[item] = o[item].toString();
          if (!this._VALID[item].test(o[item])) {
            this._handleError(cb, "invalidFormat", {
              item: item
            });
            return false;
          }
          break;
        case "ttl":
          o.ttl = parseInt(o.ttl || 7200, 10);
          if (_.isNaN(o.ttl) || !_.isNumber(o.ttl) || o.ttl < 10) {
            this._handleError(cb, "invalidValue", {
              msg: "ttl must be a positive integer >= 10"
            });
            return false;
          }
          break;
        case "dt":
          o[item] = parseInt(o[item], 10);
          if (_.isNaN(o[item]) || !_.isNumber(o[item]) || o[item] < 10) {
            this._handleError(cb, "invalidValue", {
              msg: "ttl must be a positive integer >= 10"
            });
            return false;
          }
          break;
        case "d":
          if (!o[item]) {
            this._handleError(cb, "missingParameter", {
              item: item
            });
            return false;
          }
          if (!_.isObject(o.d) || _.isArray(o.d)) {
            this._handleError(cb, "invalidValue", {
              msg: "d must be an object"
            });
            return false;
          }
          keys = _.keys(o.d);
          if (!keys.length) {
            this._handleError(cb, "invalidValue", {
              msg: "d must containt at least one key."
            });
            return false;
          }
          for (e in o.d) {
            if (!_.isString(o.d[e]) && !_.isNumber(o.d[e]) && !_.isBoolean(o.d[e]) && !_.isNull(o.d[e])) {
              this._handleError(cb, "invalidValue", {
                msg: "d." + e + " has a forbidden type. Only strings, numbers, boolean and null are allowed."
              });
              return false;
            }
          }
      }
    }
    return o;
  };

  IoRedisSessions.prototype._wipe = function() {
    var that;
    that = this;
    this.redis.zrangebyscore(this.redisns + "SESSIONS", "-inf", this._now(), function(err, resp) {
      if (!err && resp.length) {
        _.each(resp, function(e) {
          var options;
          e = e.split(':');
          options = {
            app: e[0],
            token: e[1],
            id: e[2]
          };
          that._kill(options, function() {});
        });
        return;
      }
    });
  };

  IoRedisSessions.prototype.ERRORS = {
    "missingParameter": "No <%= item %> supplied",
    "invalidFormat": "Invalid <%= item %> format",
    "invalidValue": "<%= msg %>"
  };

  return IoRedisSessions;

})(EventEmitter);

module.exports = IoRedisSessions;
