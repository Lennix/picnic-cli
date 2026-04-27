export async function readLine(label: string): Promise<string> {
  process.stdout.write(label);
  for await (const line of console) return line;
  return "";
}

export function readPassword(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(label);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error("Password input requires a TTY. Use PICNIC_PASSWORD env var instead."));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let pwd = "";
    const onData = (chunk: string) => {
      let i = 0;
      while (i < chunk.length) {
        const ch = chunk[i]!;
        // Submit
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(pwd);
          return;
        }
        // Ctrl-C
        if (ch === "") {
          stdin.setRawMode(false);
          process.exit(130);
        }
        // Backspace / Delete
        if (ch === "" || ch === "\b") {
          pwd = pwd.slice(0, -1);
          i++;
          continue;
        }
        // ESC sequence (arrow keys, function keys, bracketed paste markers): skip
        if (ch === "") {
          if (chunk[i + 1] === "[") {
            i += 2;
            while (i < chunk.length && !/[A-Za-z~]/.test(chunk[i]!)) i++;
            i++;
            continue;
          }
          i += 2;
          continue;
        }
        // Other control chars: ignore
        if (ch < " ") {
          i++;
          continue;
        }
        pwd += ch;
        i++;
      }
    };
    stdin.on("data", onData);
  });
}
