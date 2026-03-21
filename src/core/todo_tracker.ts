/**
 * Session-scoped todo/task tracker.
 * Inspired by todowrite/todoread tools.
 * Stores task lists in session memory for multi-step AI operations.
 */
import chalk from "chalk";

export interface TodoItem {
    id: string;
    title: string;
    status: "pending" | "in_progress" | "done" | "skipped";
    priority?: "high" | "medium" | "low";
    notes?: string;
}

let currentTodos: TodoItem[] = [];

/**
 * Write/update the todo list. Replaces the entire list.
 */
export function todoWrite(todos: TodoItem[]): string {
    currentTodos = todos.map((item, i) => ({
        id: item.id || `task_${i + 1}`,
        title: item.title,
        status: item.status || "pending",
        priority: item.priority || "medium",
        notes: item.notes || "",
    }));
    const counts = {
        total: currentTodos.length,
        pending: currentTodos.filter((t) => t.status === "pending").length,
        in_progress: currentTodos.filter((t) => t.status === "in_progress").length,
        done: currentTodos.filter((t) => t.status === "done").length,
        skipped: currentTodos.filter((t) => t.status === "skipped").length,
    };
    return `Todo list updated: ${counts.total} items (${counts.done} done, ${counts.in_progress} in progress, ${counts.pending} pending)`;
}

/**
 * Read the current todo list.
 */
export function todoRead(): string {
    if (!currentTodos.length) return "No todos tracked yet.";

    const statusIcon: Record<string, string> = {
        pending: chalk.gray("[ ]"),
        in_progress: chalk.blueBright("[~]"),
        done: chalk.greenBright("[\u2713]"),
        skipped: chalk.dim("[-]"),
    };

    const lines = currentTodos.map((t) => {
        const icon = statusIcon[t.status] || "?";
        const priority = t.priority === "high" ? chalk.redBright(" [HIGH]") : t.priority === "low" ? chalk.dim(" [low]") : "";
        const notes = t.notes ? chalk.italic.gray(` — ${t.notes}`) : "";
        const titleText = t.status === "done" ? chalk.dim.strikethrough(t.title) : chalk.whiteBright(t.title);
        const idText = chalk.cyan(t.id);
        return `${icon} ${idText}: ${titleText}${priority}${notes}`;
    });

    const counts = {
        total: currentTodos.length,
        done: currentTodos.filter((t) => t.status === "done").length,
    };

    lines.push(`\nProgress: ${counts.done}/${counts.total} completed`);
    return lines.join("\n");
}

/**
 * Update a single todo item's status.
 */
export function todoUpdateStatus(id: string, status: TodoItem["status"], notes?: string): string {
    const item = currentTodos.find((t) => t.id === id);
    if (!item) return `Todo item '${id}' not found.`;
    item.status = status;
    if (notes !== undefined) item.notes = notes;
    return `Updated '${id}' → ${status}`;
}

/**
 * Clear all todos (e.g. on session reset).
 */
export function todoClear(): void {
    currentTodos = [];
}
