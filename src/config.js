import {readEnvironmentVariable} from '@natlibfi/melinda-backend-commons';

export const mongoUri = readEnvironmentVariable('MONGO_URI');
export const mongoDatabaseAndCollections = readEnvironmentVariable('MONGO_DATABASE_AND_COLLECTIONS', {format: v => JSON.parse(v)});
export const pollTime = readEnvironmentVariable('POLL_TIME', {defaultValue: 21600000}); // 2h in ms (1000 ms / 60 sec / 60 min)

export const testMoment = '2021-05-08'; // Date for testing
export const earliestMoment = '2000-01-01'; // Earliest date for filtering
