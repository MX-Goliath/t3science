/** Native selectable text intentionally omits block images, so image Markdown uses the JS renderer. */
export function containsMarkdownImage(markdown: string): boolean {
  return markdown.includes("![");
}
