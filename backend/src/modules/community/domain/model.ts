export type SavedComment = {
  id: string;
  mediaId: string;
  parentId: string | null;
  text: string;
  publishedAt: number;
  observedAt: number;
};
export type CommentCollection = {
  id: string;
  mediaId: string;
  parentId: string | null;
  cursor: string | null;
  limit: number;
  status: "running" | "completed" | "failed";
  startedAt: number;
  observedAt: number | null;
  nextCursor: string | null;
  collected: number;
  commentIds: string[];
  errorCode: string | null;
  expandedReplies?: boolean;
  replyBranches?: {
    parentId: string;
    nextCursor: string | null;
    status: "exhausted" | "partial" | "omitted";
  }[];
  jobId?: string;
  pageFingerprint?: string;
};
export type CommentOwnership = { jobId: string; leaseToken: string };
export function commentSignals(comments: SavedComment[]) {
  const questions = comments.filter((item) => item.text.includes("?"));
  const words = new Map<string, SavedComment[]>();
  for (const comment of comments)
    for (const word of new Set(
      comment.text
        .normalize("NFKC")
        .toLocaleLowerCase("ru")
        .match(/[\p{L}]{4,}/gu) ?? [],
    ))
      words.set(word, [...(words.get(word) ?? []), comment]);
  return {
    sampleSize: comments.length,
    questions: questions.map((item) => ({
      commentId: item.id,
      mediaId: item.mediaId,
      text: item.text,
    })),
    recurringWords: [...words]
      .filter(([, items]) => items.length >= 2)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .slice(0, 20)
      .map(([word, items]) => ({
        word,
        count: items.length,
        examples: items.slice(0, 3).map((item) => ({ commentId: item.id, text: item.text })),
      })),
    method:
      "Question-mark detection and repeated words of at least four letters. Topics, sentiment, objections and content ideas require human/ChatGPT interpretation; these text heuristics are not facts about the audience.",
    untrustedData: true,
  };
}
