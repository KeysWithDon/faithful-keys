import type { AnalysisJob, SongChart, SourceType } from "./song-analyzer";

/**
 * Server-only contract for a compliant processor.  The GitHub Pages build
 * deliberately does not implement it: it never transfers source media.
 */
export type AnalysisProvider = {
  createJob(input: {
    userId: string;
    sourceType: SourceType;
    sourceUrl?: string;
    secureAssetId?: string;
  }): Promise<AnalysisJob>;
  getJob(userId: string, jobId: string): Promise<AnalysisJob>;
  getChart(userId: string, jobId: string): Promise<SongChart | null>;
  deleteArtifacts(userId: string, jobId: string): Promise<void>;
};

export const localReviewProvider: AnalysisProvider = {
  async createJob(input) {
    return { id: `local-${Date.now()}`, sourceType: input.sourceType, status: "review", progress: 100, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() };
  },
  async getJob(_userId, jobId) { throw new Error(`No secure analysis provider is configured for ${jobId}.`); },
  async getChart() { return null; },
  async deleteArtifacts() { /* No artifacts exist in local-only mode. */ },
};
