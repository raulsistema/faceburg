const { dockStart } = require('@nlpjs/basic');
const path = require('node:path');
const fs = require('node:fs');

let nlpInstance = null;
let isTraining = false;

async function initNlp() {
  if (nlpInstance || isTraining) return;
  isTraining = true;
  try {
    const dock = await dockStart({ use: ['Basic'] });
    nlpInstance = dock.get('nlp');
    const corpusPath = path.join(__dirname, 'traini.json');
    if (fs.existsSync(corpusPath)) {
      await nlpInstance.addCorpus(corpusPath);
    }
    await nlpInstance.train();
    console.log('NLP Model trained successfully.');
  } catch (error) {
    console.error('NLP Init Error:', error);
  } finally {
    isTraining = false;
  }
}

async function processMessage(messageText) {
  if (!nlpInstance) await initNlp();
  try {
    const response = await nlpInstance.process('pt', messageText);
    return response?.answer || null;
  } catch (error) {
    console.error('NLP Process Error:', error);
    return null;
  }
}

module.exports = { initNlp, processMessage };
