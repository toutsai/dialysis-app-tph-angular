/** Prevent an earlier async completion from replacing the latest requested view. */
export class LatestRequest {
  private generation = 0;

  begin(): number {
    return ++this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  invalidate(): void {
    ++this.generation;
  }
}
