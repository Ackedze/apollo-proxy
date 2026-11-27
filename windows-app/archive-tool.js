'use strict';
const path = require('node:path');
function tarExecutable(platform = process.platform, environment = process.env) {
  if (platform !== 'win32') return '/usr/bin/tar';
  const root = environment.SystemRoot || environment.SYSTEMROOT;
  if (typeof root !== 'string' || !path.win32.isAbsolute(root)) throw Error('WINDOWS_SYSTEM_ROOT_INVALID');
  return path.win32.join(root, 'System32', 'tar.exe');
}
module.exports = { tarExecutable };
