#!/usr/bin/env node
import http from "node:http";

const port = process.env.UNIT4_CHROME_DEBUG_PORT || "9224";
const expression = process.argv.slice(2).join(" ");

if (!expression) {
  console.error("Usage: cdp-eval.mjs <javascript-expression>");
  process.exit(2);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) {
        return;
      }

      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
      } else {
        resolve(message.result);
      }
    };
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

const tabs = await getJson(`http://127.0.0.1:${port}/json/list`);
const page = tabs.find((tab) => tab.type === "page");

if (!page) {
  console.error(`No Chrome page target found on port ${port}.`);
  process.exit(1);
}

const cdp = new CdpClient(page.webSocketDebuggerUrl);
await cdp.open();
await cdp.send("Runtime.enable");
await cdp.send("Page.enable");

const result = await cdp.send("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
});

cdp.close();

if (result.exceptionDetails) {
  console.error(JSON.stringify(result.exceptionDetails, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(result.result.value, null, 2));
