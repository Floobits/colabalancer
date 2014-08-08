/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true */
"use strict";

var util = require("util");

var log = require("floorine");
var _ = require("lodash");

var base = require("./base");
var settings = require("../settings");

var BaseProxyConnection = base.BaseProxyConnection;


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


var IRCProxyConnection = function (id, conn, server) {
  var self = this;

  BaseProxyConnection.call(self, id, conn, server);
  self.protocol = "irc";

  self.username = null;
  self.api_secret = null;
  self.path = null;

  conn.on("data", self.on_data_handler);
  conn.on("error", self.disconnect.bind(self));
  conn.on("end", function () {
    self.disconnect("IRC client connection ended.");
  });
};

util.inherits(IRCProxyConnection, BaseProxyConnection);

IRCProxyConnection.prototype.write = function () {
  var self = this,
    msg,
    args;

  args = Array.prototype.slice.call(arguments);
  args.push("\r\n");

  msg = util.format.apply(null, args);
  log.debug("IRC writing to %s: %s", self.toString(), msg);
  self.conn.write(msg);
};

IRCProxyConnection.prototype.parse_irc = function (line) {
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

IRCProxyConnection.prototype.on_data = function (d) {
  var self = this,
    f,
    line,
    newline_index,
    msg;

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
      log.error("No IRCProxyConnection handler for event %s.", msg.command);
    }
  }
};

IRCProxyConnection.prototype.check_auth = function () {
  var self = this;

  if (self.username && self.api_secret && !self.sent_welcome) {
    self.sent_welcome = true;
    self.write("001 %s :Welcome to Floobits IRC", self.username);
  }

  if (!self.username || !self.api_secret || !self.path) {
    log.debug("%s %s %s", self.username, self.api_secret, self.path);
    return;
  }

  // TODO: multiplex colab connections
  if (!self.auth_timeout_id) {
    log.warn("IRC check_auth: Auth timeout already cancelled. Not checking auth again.");
    return;
  }
  self.cancel_auth_timeout();

  self.on_auth({
    username: self.username,
    secret: self.api_secret,
    path: self.path,
    version: base.PROTO_VERSION
  }, self.forward_data.bind(self));
};

IRCProxyConnection.prototype._on_nick = function (msg) {
  var self = this;

  self.username = msg.args[0];
  self.write(":%s!%s@%s NICK :%s", self.username, self.username, self._remote_address(), self.username);
  self.check_auth();
};

IRCProxyConnection.prototype._on_user = function (msg) {
  var self = this;

  self.username = msg.args[0];
  self.check_auth();
};

IRCProxyConnection.prototype._on_pass = function (msg) {
  var self = this;

  self.api_secret = msg.args[0];
  self.check_auth();
};

IRCProxyConnection.prototype._on_join = function (msg) {
  var self = this;

  self.path = msg.args[0].slice(1);
  self.check_auth();
};

IRCProxyConnection.prototype._on_ping = function () {
  var self = this;
  if (self.colab_conn) {
    self.colab_conn.write(JSON.stringify({
      name: "ping"
    }) + "\n");
  } else {
    self.write("PONG %s", settings.irc_server_name);
  }
};

IRCProxyConnection.prototype._on_pong = function () {
  var self = this;
  self.colab_conn.write(JSON.stringify({
    name: "pong"
  }) + "\n");
};

IRCProxyConnection.prototype._on_privmsg = function (msg) {
  var self = this,
    target = msg.args[0],
    txt = msg.args[1];

  if (!target || !txt) {
    log.warn("IRC: No target or text. Target %s text %s", target, txt);
    return;
  }

  if (target !== "#" + self.path) {
    log.warn("IRC: Path is %s but target is %s", self.path, target);
  }

  self.colab_conn.write(JSON.stringify({
    name: "msg",
    data: txt.slice(1)
  }) + "\n");
};

IRCProxyConnection.prototype._on_names = function (msg) {
  var self = this,
    targets = msg.args[0];

  if (targets) {
    targets = targets.split(",");
  }
  self.write("%s %s = #%s :%s",
    IRC_RES.NAMREPLY,
    self.username,
    self.path,
    _.uniq(_.pluck(self.users, "username")).join(" "));
  self.write(IRC_RES.ENDOFNAMES);

};

IRCProxyConnection.prototype.forward_data = function (err, reason) {
  var self = this;

  if (err) {
    self.disconnect(err, reason);
    return;
  }

  if (!self.conn) {
    self.disconnect("Client connection lost.");
    return;
  }

  self.colab_conn.on("data", self.on_colab_data.bind(self));
  self.colab_conn.on("end", self.disconnect.bind(self));
  self.colab_conn.on("error", self.disconnect.bind(self));
  self._on_names({args: []});
};

IRCProxyConnection.prototype.handle_colab_msg = function (msg) {
  var self = this;

  log.log(msg);
  switch (msg.name) {
  case "msg":
    self.write(":%s PRIVMSG #%s :%s", msg.username, self.path, msg.data);
    break;
  case "ping":
    self.write("PING");
    break;
  case "pong":
    self.write("PONG");
    break;
  case "room_info":
    self.users = msg.users;
    break;
  default:
    log.debug("IRC: No handler for colab msg %s", msg.name);
    break;
  }
};

IRCProxyConnection.prototype.disconnect = function (err, reason) {
  var self = this;

  log.log("Disconnecting %s: %s", self.id, err);
  self.cancel_auth_timeout();

  if (reason) {
    self.write("ERROR :%s", reason);
  }

  if (self.colab_conn) {
    try {
      self.colab_conn.destroy();
    } catch (e) {
      log.error("Error disconnecting from colab:", e);
    }
  }

  try {
    self.conn.destroy();
  } catch (e2) {
    log.error("Error disconnecting %s: %s", self.id, e2);
  }
  self.emit("on_conn_end", self);
};

module.exports = {
  IRCProxyConnection: IRCProxyConnection,
};
