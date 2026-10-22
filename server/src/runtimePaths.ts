import path from 'path';

// Tests can use a disposable directory without touching personal data.
export const DATA_DIR = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
