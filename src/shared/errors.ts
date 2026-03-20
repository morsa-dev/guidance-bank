export class MbCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MbCliError";
  }
}

export class ValidationError extends MbCliError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class UserInputError extends MbCliError {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}
