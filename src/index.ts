process.env.NODE_NO_WARNINGS = process.env.NODE_NO_WARNINGS || "1";
process.noDeprecation = true;
const SEA_WARNING_SNIPPETS = [
  "Single executable application is an experimental feature",
  "single-executable applications only supports loading built-in modules",
  "Support for bundled module loading or virtual file systems",
  "punycode",
];
const containsSuppressedWarning = (text: string) =>
  SEA_WARNING_SNIPPETS.some((snippet) => text.includes(snippet));

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stdout.write = ((chunk: any, ...args: any[]) => {
  const msg = String(chunk ?? "");
  if (containsSuppressedWarning(msg)) return true;
  return (originalStdoutWrite as any)(chunk, ...args);
}) as typeof process.stdout.write;
process.stderr.write = ((chunk: any, ...args: any[]) => {
  const msg = String(chunk ?? "");
  if (containsSuppressedWarning(msg)) return true;
  return (originalStderrWrite as any)(chunk, ...args);
}) as typeof process.stderr.write;

if (process.stdout.isTTY) {
  // SEA warnings can print during boot; clear a few times during startup.
  process.stdout.write("\x1Bc");
  setTimeout(() => {
    process.stdout.write("\x1Bc");
  }, 50);
  setTimeout(() => {
    process.stdout.write("\x1Bc");
  }, 200);
}
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: any, ...args: any[]) => {
  const msg = String(warning?.message || warning || "");
  if (containsSuppressedWarning(msg)) {
    return;
  }
  return (originalEmitWarning as any)(warning, ...args);
}) as typeof process.emitWarning;
process.on("warning", (warning) => {
  const msg = String((warning as any)?.message || warning || "");
  if (containsSuppressedWarning(msg)) {
    return;
  }
  console.warn(warning);
});

async function main() {
  const { runMain } = await import("./main");
  await runMain();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
