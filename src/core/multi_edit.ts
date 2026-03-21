/**
 * Multi-edit tool for applying batch modifications to a single file.
 * Includes search-and-replace with regex and preview support.
 */
import fs from "fs-extra";
import { printDiffInline, printFileHeader } from "../ui/console";

export interface EditOperation {
    search: string | RegExp;
    replace: string;
    description?: string;
}

/**
 * Apply a series of edits to a file and show a diff preview.
 */
export async function multiEdit(filePath: string, edits: EditOperation[]): Promise<string> {
    const content = await fs.readFile(filePath, "utf8");
    let newContent = content;

    for (const edit of edits) {
        newContent = newContent.replace(edit.search, edit.replace);
    }

    if (content === newContent) {
        return "No changes made (patterns did not match).";
    }

    printFileHeader(filePath, newContent.split("\n").length, "\uD83D\uDCDD");
    printDiffInline(filePath, content, newContent);

    await fs.writeFile(filePath, newContent, "utf8");
    return `Successfully applied ${edits.length} edits to ${filePath}.`;
}

/**
 * Perform a regex search and replace across a file with preview.
 */
export async function searchAndReplace(
    filePath: string,
    pattern: string,
    replacement: string,
    flags = "g"
): Promise<string> {
    const regex = new RegExp(pattern, flags);
    const content = await fs.readFile(filePath, "utf8");
    const newContent = content.replace(regex, replacement);

    if (content === newContent) {
        return `Pattern '${pattern}' not found in ${filePath}.`;
    }

    printFileHeader(filePath, newContent.split("\n").length, "\uD83D\uDD0D");
    printDiffInline(filePath, content, newContent);

    await fs.writeFile(filePath, newContent, "utf8");
    const matches = (content.match(regex) || []).length;
    return `Successfully replaced ${matches} occurrences of '${pattern}' in ${filePath}.`;
}
