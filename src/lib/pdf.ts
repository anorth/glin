import { extractText, getDocumentProxy } from "unpdf";

/** Extract merged plain text from a PDF buffer via unpdf. */
export async function extractPdfText(body: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(body);
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}
