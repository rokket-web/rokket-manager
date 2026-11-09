export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}
export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}
export class ConflictError extends Error {
  constructor(message = "That conflicts with the current state.") {
    super(message);
    this.name = "ConflictError";
  }
}
