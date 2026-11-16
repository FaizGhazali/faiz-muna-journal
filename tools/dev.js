// Starts the local emulators (app on :5000, emulator UI on :4000).
// On this Windows machine Java can't open its internal local sockets inside %TEMP%, so the
// Firestore emulator dies with "Unable to establish loopback connection". Giving Java a socket
// folder under the user profile instead fixes it.
const { spawn } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");

const env = { ...process.env };
if (process.platform === "win32") {
  const dir = path.join(os.homedir(), ".cache", "firebase", "uds");
  fs.mkdirSync(dir, { recursive: true });
  env.JAVA_TOOL_OPTIONS = `${env.JAVA_TOOL_OPTIONS || ""} -Djdk.net.unixdomain.tmpdir=${dir}`.trim();
}
const cli = path.join(__dirname, "..", "node_modules", "firebase-tools", "lib", "bin", "firebase.js");
const args = ["emulators:start", "--config", "firebase.dev.json", "--project", "demo-journal", "--only", "auth,firestore,hosting"];
spawn(process.execPath, [cli, ...args], { cwd: path.join(__dirname, ".."), env, stdio: "inherit" })
  .on("exit", (code) => process.exit(code ?? 0));
