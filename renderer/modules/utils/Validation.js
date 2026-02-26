/**
 * Check if a value is a valid star rating
 * @param {*} value - Value to check
 * @returns {boolean} True if valid star rating
 */
export const isValidStarRating = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Check if a star rating value is missing or invalid
 * @param {*} value - Value to check
 * @returns {boolean} True if star rating is missing
 */
export const isStarRatingMissing = (value) => !isValidStarRating(value);
