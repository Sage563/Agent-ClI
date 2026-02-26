import { listRecentDiffBatches, readDiffBatchesFromDisk } from "../core/diff_tracker";
import { printInfo, printPanel } from "../ui/console";
import { registry } from "./registry";

function renderDiffBatches(limit: number) {
  const inMemory = listRecentDiffBatches(limit);
  const batches = inMemory.length ? inMemory : readDiffBatchesFromDisk(limit);
  if (!batches.length) {
    return "No AI-applied diffs recorded yet in this session/day.";
  }

  const lines: string[] = [];
  batches.forEach((batch, idx) => {
    const stamp = new Date(batch.at).toISOString();
    lines.push(`## ${idx + 1}. ${stamp}`);
    if (batch.task) lines.push(`Task: ${batch.task}`);
    batch.files.forEach((file) => {
      lines.push(`- \`${file.file}\`: +${file.added} / -${file.removed}`);
    });
    lines.push("");
  });
  return lines.join("\n").trim();
}

registry.register("/list_diff", "List recent AI-applied file diffs (+/- lines)", ["/diffs"])((_, args) => {
  const raw = Number(args[1] || 20);
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(100, Math.floor(raw))) : 20;
  const content = renderDiffBatches(limit);
  printPanel(content, "AI Diff History", "cyan", true);
  printInfo("Use `/list_diff <n>` to change how many diff batches are shown.");
  return true;
});

