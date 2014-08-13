/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true */
"use strict";

var events = require("events");
var util = require("util");

var log = require("floorine");
var _ = require("lodash");

var base = require("./base");
var settings = require("../settings");

var BaseProxyConnection = base.BaseProxyConnection;
var CONN_STATES = base.CONN_STATES;


var IRC_RES = {
  WELCOME:            "001",
  YOURHOST:           "002",
  CREATED:            "003",
  MYINFO:             "004",
  BOUNCE:             "005",
  TRACELINK:          "200",
  TRACECONNECTING:    "201",
  TRACEHANDSHAKE:     "202",
  TRACEUNKNOWN:       "203",
  TRACEOPERATOR:      "204",
  TRACEUSER:          "205",
  TRACESERVER:        "206",
  TRACESERVICE:       "207",
  TRACENEWTYPE:       "208",
  TRACECLASS:         "209",
  TRACERECONNECT:     "210",
  STATSLINKINFO:      "211",
  STATSCOMMANDS:      "212",
  ENDOFSTATS:         "219",
  UMODEIS:            "221",
  SERVLIST:           "234",
  SERVLISTEND:        "235",
  STATSUPTIME:        "242",
  STATSOLINE:         "243",
  LUSERCLIENT:        "251",
  LUSEROP:            "252",
  LUSERUNKNOWN:       "253",
  LUSERCHANNELS:      "254",
  LUSERME:            "255",
  ADMINME:            "256",
  ADMINLOC1:          "257",
  ADMINLOC2:          "258",
  ADMINEMAIL:         "259",
  TRACELOG:           "261",
  TRACEEND:           "262",
  TRYAGAIN:           "263",
  AWAY:               "301",
  USERHOST:           "302",
  ISON:               "303",
  UNAWAY:             "305",
  NOWAWAY:            "306",
  WHOISUSER:          "311",
  WHOISSERVER:        "312",
  WHOISOPERATOR:      "313",
  WHOWASUSER:         "314",
  ENDOFWHO:           "315",
  WHOISIDLE:          "317",
  ENDOFWHOIS:         "318",
  WHOISCHANNELS:      "319",
  LISTSTART:          "321",
  LIST:               "322",
  LISTEND:            "323",
  CHANNELMODEIS:      "324",
  UNIQOPIS:           "325",
  NOTOPIC:            "331",
  TOPIC:              "332",
  INVITING:           "341",
  SUMMONING:          "342",
  INVITELIST:         "346",
  ENDOFINVITELIST:    "347",
  EXCEPTLIST:         "348",
  ENDOFEXCEPTLIST:    "349",
  VERSION:            "351",
  WHOREPLY:           "352",
  NAMREPLY:           "353",
  LINKS:              "364",
  ENDOFLINKS:         "365",
  ENDOFNAMES:         "366",
  BANLIST:            "367",
  ENDOFBANLIST:       "368",
  ENDOFWHOWAS:        "369",
  INFO:               "371",
  MOTD:               "372",
  ENDOFINFO:          "374",
  MOTDSTART:          "375",
  ENDOFMOTD:          "376",
  YOUREOPER:          "381",
  REHASHING:          "382",
  YOURESERVICE:       "383",
  TIME:               "391",
  USERSSTART:         "392",
  USERS:              "393",
  ENDOFUSERS:         "394",
  NOUSERS:            "395"
};

var IRC_ERR = {
  NOSUCHNICK:         "401",
  NOSUCHSERVER:       "402",
  NOSUCHCHANNEL:      "403",
  CANNOTSENDTOCHAN:   "404",
  TOOMANYCHANNELS:    "405",
  WASNOSUCHNICK:      "406",
  TOOMANYTARGETS:     "407",
  NOSUCHSERVICE:      "408",
  NOORIGIN:           "409",
  NORECIPIENT:        "411",
  NOTEXTTOSEND:       "412",
  NOTOPLEVEL:         "413",
  WILDTOPLEVEL:       "414",
  BADMASK:            "415",
  UNKNOWNCOMMAND:     "421",
  NOMOTD:             "422",
  NOADMININFO:        "423",
  FILEERROR:          "424",
  NONICKNAMEGIVEN:    "431",
  ERRONEUSNICKNAME:   "432",
  NICKNAMEINUSE:      "433",
  NICKCOLLISION:      "436",
  UNAVAILRESOURCE:    "437",
  USERNOTINCHANNEL:   "441",
  NOTONCHANNEL:       "442",
  USERONCHANNEL:      "443",
  NOLOGIN:            "444",
  SUMMONDISABLED:     "445",
  USERSDISABLED:      "446",
  NOTREGISTERED:      "451",
  NEEDMOREPARAMS:     "461",
  ALREADYREGISTRED:   "462",
  NOPERMFORHOST:      "463",
  PASSWDMISMATCH:     "464",
  YOUREBANNEDCREEP:   "465",
  YOUWILLBEBANNED:    "466",
  KEYSET:             "467",
  CHANNELISFULL:      "471",
  UNKNOWNMODE:        "472",
  INVITEONLYCHAN:     "473",
  BANNEDFROMCHAN:     "474",
  BADCHANNELKEY:      "475",
  BADCHANMASK:        "476",
  NOCHANMODES:        "477",
  BANLISTFULL:        "478",
  NOPRIVILEGES:       "481",
  CHANOPRIVSNEEDED:   "482",
  CANTKILLSERVER:     "483",
  RESTRICTED:         "484",
  UNIQOPPRIVSNEEDED:  "485",
  NOOPERHOST:         "491",
  NOSERVICEHOST:      "492",
  UMODEUNKNOWNFLAG:   "501",
  USERSDONTMATCH:     "502"
};


var IRCColabConnection = function (id, conn, server) {
  var self = this;

  BaseProxyConnection.call(self, id, conn, server);
  self.protocol = "irc";
  self.conn = null;

  // IRCMultiplexer has an auth timeout
  self.cancel_auth_timeout();

  conn.on("error", self.disconnect.bind(self));
  conn.on("end", function () {
    self.disconnect("IRC client connection ended.");
  });
};

util.inherits(IRCColabConnection, BaseProxyConnection);

IRCColabConnection.prototype.forward_data = function () {
  var self = this;

  // self.colab_conn.removeListener("data", self.on_data_handler);
  self.on_data_handler = null;
  self.colab_conn.on("data", self.on_colab_data.bind(self));
};

IRCColabConnection.prototype.on_data = function (data) {
  log.error("DATA WTF", data);
  return;
};

IRCColabConnection.prototype.disconnect = function (err, reason) {
  var self = this;

  if (self.state === CONN_STATES.colab_disconnected) {
    log.error("Already disconnected %s", self.toString());
    return;
  }
  if (self.colab_conn) {
    try {
      self.colab_conn.destroy();
    } catch (e) {
      log.error("Error disconnecting from colab:", e);
    }
  }

  self.colab_conn = null;
  self.state = CONN_STATES.colab_disconnected;
  self.emit("disconnect", err, reason);
};

IRCColabConnection.prototype.write = function (msg) {
  var self = this;

  self.colab_conn.write(JSON.stringify(msg));
  self.colab_conn.write("\n");
};

var IRCMultiplexer = function (id, conn, server) {
  var self = this;

  BaseProxyConnection.call(self, id, conn, server);
  self.server = server;
  self.protocol = "irc";

  self.username = null;
  self.api_secret = null;
  self.colab_conns = {};

  conn.on("data", self.on_data_handler);
  conn.on("error", self.disconnect.bind(self));
  conn.on("end", function () {
    self.disconnect("IRC client connection ended.");
  });
};

util.inherits(IRCMultiplexer, BaseProxyConnection);

IRCMultiplexer.prototype.write = function () {
  var self = this,
    msg,
    args;

  args = Array.prototype.slice.call(arguments);
  args.push("\r\n");

  msg = util.format.apply(null, args);
  log.debug("IRC writing to %s: %s", self.toString(), msg);
  self.conn.write(msg);
};

IRCMultiplexer.prototype.reply = function () {
  var self = this,
    args = Array.prototype.slice.call(arguments),
    code = args[0],
    msg;

  args = args.slice(1);
  msg = util.format(":%s %s %s", settings.irc_server_name, code, util.format.apply(null, args));
  self.write(msg);
};

IRCMultiplexer.prototype.parse_irc = function (line) {
  var self = this,
    args,
    command,
    prefix;

  log.debug("line: '%s'", line);
  args = line.split(" ");

  if (line[0] === ":") {
    prefix = line.split(" ")[0].slice(1);
    log.debug("prefix: %s", prefix);
    if (prefix !== self.username) {
      self.disconnect("Your IRC client sent an invalid prefix.");
    }
    command = args[1];
    args = args.slice(2);
  } else {
    command = args[0];
    args = args.slice(1);
  }

  return {
    args: args,
    command: command.toLowerCase(),
    prefix: prefix
  };
};

IRCMultiplexer.prototype.on_data = function (d) {
  var self = this,
    f,
    line,
    newline_index,
    msg,
    username = self.username ? self.username + " " : "";

  log.debug("d: |" + d + "|");

  if (self.buf.length + d.length > settings.max_buf_len) {
    self.disconnect("Sorry. Your client sent a message that is too big.");
    return;
  }

  self.buf += d;

  newline_index = self.buf.indexOf("\r\n");
  while (newline_index !== -1) {
    line = self.buf.slice(0, newline_index);
    self.buf = self.buf.slice(newline_index + 2);
    msg = self.parse_irc(line);
    log.debug("parsed line: %s", JSON.stringify(msg));
    newline_index = self.buf.indexOf("\r\n");

    f = self["_on_" + msg.command];
    if (f) {
      f.call(this, msg);
    } else {
      log.error("No IRCMultiplexer handler for event %s.", msg.command);
      self.reply(IRC_ERR.UNKNOWNCOMMAND, "%s%s :Unknown command.", username, msg.command);
    }
  }
};

IRCMultiplexer.prototype.welcome = function () {
  var self = this;

  if (!self.username || !self.api_secret || self.sent_welcome) {
    return;
  }
  self.sent_welcome = true;
  self.reply(IRC_RES.WELCOME, ":Welcome to Floobits IRC, %s", self.username);
  self.reply(IRC_RES.YOURHOST, ":Your host is %s, running version u2.10.04", settings.irc_server_name);
  self.reply(IRC_RES.CREATED, ":This server was created %s", self.server.start_time);
  self.reply(IRC_RES.MYINFO, "%s %s dioswkg biklmnopstv", settings.irc_server_name, settings.irc_server_version);
  // self.reply(IRC_RES.BOUNCE, "%s :CHANTYPES=# NETWORK=Floobits", self.username);
};

IRCMultiplexer.prototype.check_auth = function (target) {
  var self = this,
    colab_conn = self.colab_conns[target];

  if (!self.username || !self.api_secret) {
    // TODO
    log.debug("%s %s %s", self.username, self.api_secret, JSON.stringify(self.colab_conns));
    return;
  }

  if (self.auth_timeout_id) {
    self.cancel_auth_timeout();
  }

  if (colab_conn) {
    return;
  }

  colab_conn = new IRCColabConnection(self.id, self.conn, self.server);
  colab_conn.on("disconnect", function (err, reason) {
    delete self.colab_conns[target];
    self.disconnect(err, reason);
  });

  self.colab_conns[target] = colab_conn;

  // TODO: multiplex colab connections
  colab_conn.on_auth({
    username: self.username,
    secret: self.api_secret,
    path: target,
    version: base.PROTO_VERSION
  }, self.forward_data.bind(self, target));
};

IRCMultiplexer.prototype._on_nick = function (msg) {
  var self = this;

  self.username = msg.args[0];
  self.write(":%s!%s@%s NICK :%s", self.username, self.username, self.remote_address, self.username);
  self.welcome();
};

IRCMultiplexer.prototype._on_user = function (msg) {
  var self = this;

  if (self.username) {
    // TODO
    return;
  }
  self.username = msg.args[0];
  self.write("NICK %s", self.username);
  self.welcome();
};

IRCMultiplexer.prototype._on_pass = function (msg) {
  var self = this;

  if (self.api_secret) {
    // TODO
    return;
  }
  self.api_secret = msg.args[0];
  self.welcome();
};

IRCMultiplexer.prototype._on_join = function (msg) {
  var self = this,
    channels;

  channels = msg.args[0].split(",");
  _.each(channels, function (channel) {
    self.check_auth(channel.slice(1));
  });
};

IRCMultiplexer.prototype._on_who = function (msg) {
  var self = this,
    colab_conn,
    target = msg.args[0].slice(1);

  target = target.slice(1);
  colab_conn = self.colab_conns[target];

  if (!colab_conn) {
    self.write("%s: :You can't WHO %s", IRC_ERR.USERSDONTMATCH, target);
    return;
  }
  // 352: #eclipse-dev ~pwebster eclipse/developer/Eclipse/paulweb515 hobana.freenode.net paulweb515 G 0 purple
  _.each(colab_conn.users, function (user) {
    self.reply(IRC_RES.WHOREPLY, "%s %s %s %s %s %s H :0 %s",  self.username, target,  user.username, "?", "?", user.username, user.username);
  });

  self.reply(IRC_RES.ENDOFWHO, "%s %s :End of /WHO list", self.username, target);
};

IRCMultiplexer.prototype._on_mode = function (msg) {
  var self = this,
    target = msg.args[0],
    mode = msg.args[1];

  if (target === self.username) {
    if (mode !== "+i") {
      self.write("%s: :Unknown mode %s", IRC_ERR.UMODEUNKNOWNFLAG, mode);
      return;
    }

    self.reply(IRC_RES.UMODEIS, "%s", mode);
  } else if (_.contains(target.slice(1), _.keys(self.colab_conns))) {
    if (mode === "b") {
      self.reply(IRC_RES.ENDOFBANLIST, "%s End of Channel Ban List", target);
    }
  } else {
    self.write("%s: :Target %s doesn't match username or channel", IRC_ERR.USERSDONTMATCH, target);
    return;
  }
};

IRCMultiplexer.prototype._on_ping = function () {
  var self = this;
  self.write("PONG %s", settings.irc_server_name);
};

IRCMultiplexer.prototype._on_privmsg = function (msg) {
  var self = this,
    colab_conn,
    target = msg.args[0],
    txt = msg.args[1];

  if (!target || !txt) {
    log.warn("IRC: No target or text. Target %s text %s", target, txt);
    return;
  }

  target = target.slice(1);

  colab_conn = self.colab_conns[target];

  if (!colab_conn) {
    log.warn("IRC: Colab conns are %s but target is %s", _.keys(self.colab_conns), target);
    // TODO: send an error back or something
    return;
  }

  colab_conn.write({
    name: "msg",
    data: txt.slice(1)
  });
};

IRCMultiplexer.prototype._on_topic = function (msg) {
  var self = this,
    targets = msg.args[0];

  if (targets) {
    targets = targets.split(",");
  }
  _.each(targets, function (target) {
    self.reply(IRC_RES.NOTOPIC, "#%s :No topic is set", target);
  });
};

IRCMultiplexer.prototype._on_names = function (msg) {
  var self = this,
    targets = msg.args[0];

  if (targets) {
    targets = targets.split(",");
  }
  _.each(targets, function (target) {
    var colab_conn,
      usernames;
    target = target.slice(1);
    colab_conn = self.colab_conns[target];

    if (!colab_conn) {
      return;
    }

    usernames = _.uniq(_.pluck(colab_conn.users, "username")).join(" ");

    if (usernames.length > 0) {
      self.reply(IRC_RES.NAMREPLY, "= #%s :%s",
        target,
        usernames);
    } else {
      log.warn("No usernames for %s. colab_conn.users is %s", target, JSON.stringify(colab_conn.users));
    }
    self.reply(IRC_RES.ENDOFNAMES, "#%s :End of /NAMES list.", target);
  });
};

IRCMultiplexer.prototype._on_quit = function (msg) {
  var self = this;
  self.disconnect(null, msg.args[0]);
};

IRCMultiplexer.prototype.forward_data = function (target, err, reason) {
  var self = this,
    colab_conn = self.colab_conns[target];

  if (err) {
    self.reply(IRC_ERR.NOSUCHCHANNEL, "#%s :%s", target, reason);
    return;
  }

  if (!self.conn) {
    self.disconnect("Client connection lost.");
    return;
  }

  if (!colab_conn) {
    self.reply(IRC_ERR.NOSUCHCHANNEL, "#%s :Colab server connection died.", target);
    return;
  }

  if (self.state < CONN_STATES.active) {
    self.state = CONN_STATES.active;
  }

  colab_conn.handle_colab_msg = function (msg) {
    self.handle_colab_msg(target, msg);
  };
  colab_conn.forward_data();
};

IRCMultiplexer.prototype.handle_colab_msg = function (p, msg) {
  var self = this,
    colab_conn = self.colab_conns[p];

  log.debug("Colab message to IRC client %s: %s", self.toString(), JSON.stringify(msg));
  switch (msg.name) {
  case "msg":
    self.write(":%s PRIVMSG #%s :%s", msg.username, p, msg.data);
    break;
  case "ping":
    if (self.conn && self.state === CONN_STATES.active) {
      colab_conn.write({ name: "pong" });
    }
    break;
  case "pong":
    // Should never happen, since we don't forward pings to colabs
    break;
  case "room_info":
    colab_conn.room_info = msg;
    colab_conn.users = msg.users;
    self._on_names({args: ["#" + p]});
    break;
  case "join":
    self.write("JOIN #%s", p, msg.username);
    break;
  case "part":
    self.write("PART #%s", p, msg.username);
    break;
  default:
    log.debug("IRC: No handler for colab msg %s %s", p, msg.name);
    break;
  }
};

IRCMultiplexer.prototype.disconnect = function (err, reason) {
  var self = this;

  log.log("Disconnecting %s: %s", self.id, err);
  self.cancel_auth_timeout();

  if (reason) {
    self.write("ERROR :%s", reason);
  }

  _.each(self.colab_conns, function (colab_conn, p) {
    try {
      colab_conn.disconnect(err, reason);
    } catch (e) {
      log.error("Error disconnecting from colab %s: %s", p, e);
    }
  });

  try {
    self.conn.destroy();
  } catch (e2) {
    log.error("Error disconnecting %s: %s", self.id, e2);
  }
  self.state = CONN_STATES.colab_disconnected;
  self.emit("on_conn_end", self);
};


module.exports = {
  IRCMultiplexer: IRCMultiplexer,
  IRCColabConnection: IRCColabConnection
};
