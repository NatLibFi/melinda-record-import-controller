import {readEnvironmentVariable} from '@natlibfi/melinda-backend-commons';

export const mongoUri = readEnvironmentVariable('MONGO_URI');
export const mongoDatabaseAndCollections = readEnvironmentVariable('MONGO_DATABASE_AND_COLLECTIONS', {format: v => JSON.parse(v)});
export const pollTime = readEnvironmentVariable('POLL_TIME', {defaultValue: 21600000}); // 2h in ms (1000 ms / 60 sec / 60 min)
