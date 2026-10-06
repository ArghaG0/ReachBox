import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";

export async function startSmtp() {
  const messages: string[] = [];
  const server = new SMTPServer({
    allowInsecureAuth: true, // This listener is bound only to loopback in tests.
    disabledCommands: ["STARTTLS"],
    onAuth(auth, _session, callback) {
      if (auth.username !== "test" || auth.password !== "test") return callback(new Error("Invalid credentials"));
      callback(null, { user: "test" });
    },
    onData(stream, _session, callback) {
      let data = "";
      stream.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      stream.on("end", () => { messages.push(data); callback(); });
      stream.on("error", callback);
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: (server.server.address() as AddressInfo).port,
    messages,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
