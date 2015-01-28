/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true */
"use strict";

var _ = require("lodash");

var local_settings = {};

exports.ssl_cert = "/etc/ssl/certs/floobits-dev.crt";
exports.ssl_key = "/etc/ssl/private/floobits-dev.key";
exports.ssl_ca = ["/etc/ssl/certs/startssl-sub.class2.server.sha2.ca.pem"];
exports.ciphers = "ECDHE-RSA-AES256-SHA384:AES256-SHA256:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM";

exports.log_level = "debug";

exports.request_defaults = {
  headers: {
    "User-Agent": "Colabalancer"
  }
};

exports.cache_servers = ["127.0.0.1:11211"];
exports.control_servers = ["http://127.0.0.1:8090"];

exports.conn_keepalive = 30000;
exports.conn_timeout = 20 * 60 * 1000;
exports.auth_timeout = 10000;

exports.heartbeat_interval = 15000;
exports.idle_timeout = 120000;

exports.irc_port = 6667;
exports.irc_port_ssl = 6697;
exports.json_port = 3148;
exports.json_port_ssl = 3448;
exports.engine_io_port = 8048;
exports.engine_io_port_ssl = 8448;
exports.engine_io_transports = ["websocket"];

exports.metrics_port = 8082;

exports.irc_server_name = "irc.floobits.com";
exports.irc_server_version = "u2.10.04";

try {
  local_settings = require("./local_settings.js");
} catch (e) {
  console.error("Error loading local settings:", e);
  process.exit(1);
}

_.each(local_settings, function (v, k) {
  exports[k] = v;
});
