import { ComponentLibraryValidationError } from '../services/componentLibrary.js';
import { INVALID_COMPONENT_IDENTIFIER_MESSAGE } from './validation.js';

export function createInvalidComponentIdentifierError(): ComponentLibraryValidationError {
  return new ComponentLibraryValidationError(INVALID_COMPONENT_IDENTIFIER_MESSAGE);
}
