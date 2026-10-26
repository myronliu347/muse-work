export class SkillMarketError extends Error {
  readonly status: 400 | 404 | 409 | 502;

  constructor(message: string, status: 400 | 404 | 409 | 502) {
    super(message);
    this.name = "SkillMarketError";
    this.status = status;
  }
}
