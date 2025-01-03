/**
 * Sleep for specified milliseconds
 * @param {number} ms - milliseconds to sleep
 * @returns {Promise} resolves after specified milliseconds
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
    sleep
};
