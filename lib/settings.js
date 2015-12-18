"use strict";

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

exports.control_servers = ["http://localhost:8090"];

exports.conn_keepalive = 30000;
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

exports.irc_server_name = "irc.floobits.com";
exports.irc_server_version = "u2.10.04";

let local_settings = {};
try {
  local_settings = require("./local_settings.js");
} catch (e) {
  throw new Error("Error loading local settings:" + e.toString());
}

for (let k of Object.keys(local_settings)) {
  exports[k] = local_settings[k];
}
