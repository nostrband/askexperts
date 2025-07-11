/**
 * Error classes for AskExpertsClient
 */

/**
 * Base error class for AskExpertsClient
 */
export class AskExpertsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AskExpertsError';
  }
}

/**
 * Error thrown when a relay operation fails
 */
export class RelayError extends AskExpertsError {
  constructor(message: string) {
    super(message);
    this.name = 'RelayError';
  }
}

/**
 * Error thrown when a timeout occurs
 */
export class TimeoutError extends AskExpertsError {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when an expert returns an error
 */
export class ExpertError extends AskExpertsError {
  constructor(message: string) {
    super(message);
    this.name = 'ExpertError';
  }
}

/**
 * Error thrown when payment fails
 */
export class PaymentError extends AskExpertsError {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentError';
  }
}

/**
 * Error thrown when payment is rejected by the client
 */
export class PaymentRejectedError extends PaymentError {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentRejectedError';
  }
}

/**
 * Error thrown when payment fails due to technical issues
 */
export class PaymentFailedError extends PaymentError {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentFailedError';
  }
}

/**
 * Error thrown when an invalid event is received
 */
export class InvalidEventError extends AskExpertsError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEventError';
  }
}

/**
 * Error thrown when decryption fails
 */
export class DecryptionError extends AskExpertsError {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/**
 * Error thrown when decompression fails
 */
export class DecompressionError extends AskExpertsError {
  constructor(message: string) {
    super(message);
    this.name = 'DecompressionError';
  }
}