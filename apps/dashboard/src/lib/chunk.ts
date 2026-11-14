import { KNOWLEDGE_LIMITS } from "@lotse/shared";

/**
 * Splits pasted text / markdown into chunks for embedding: on headings and blank lines, small paragraphs
 * merged up to maxChars, overlong ones hard-split. Each chunk starts with its nearest heading line.
 */
export function chunkText(text: string, maxChars = 800): string[] {
  const limit = Math.max(2, Math.min(maxChars, KNOWLEDGE_LIMITS.maxChunkChars));
  const chunks: string[] = [];
  let heading = "";
  let body = "";
  let para = "";
  const room = () => Math.max(1, limit - (heading ? heading.length + 1 : 0));
  const flush = () => {
    if (body) chunks.push(heading ? `${heading}\n${body}` : body);
    body = "";
  };
  const addPara = () => {
    let p = para.trim();
    para = "";
    while (p) {
      const n = room();
      let piece = p;
      if (p.length > n) {
        const cut = p.lastIndexOf(" ", n);
        piece = p.slice(0, cut > n / 2 ? cut : n).trim();
      }
      p = p.slice(piece.length).trim();
      if (body && body.length + 2 + piece.length > n) flush();
      body = body ? `${body}\n\n${piece}` : piece;
    }
  };

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^#{1,6}\s/.test(line.trim())) {
      addPara();
      flush();
      heading = line.trim().slice(0, Math.floor(limit / 2));
    } else if (!line.trim()) addPara();
    else para += `${line}\n`;
  }
  addPara();
  flush();
  return chunks;
}
