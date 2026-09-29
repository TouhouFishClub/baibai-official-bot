const fs = require('fs');
const path = require('path');

const IMAGE_DATA = path.resolve(
  process.env.IMAGE_DATA_DIR || path.join(__dirname, 'public', 'generated')
);

for (const directory of ['mabi', 'mabi_other', 'mabi_recipe', 'food']) {
  fs.mkdirSync(path.join(IMAGE_DATA, directory), { recursive: true });
}

module.exports = {
  IMAGE_DATA
};
