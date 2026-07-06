const { config } = require('dotenv');
config();

const { generateQuizQuestion } = require('../../../engines');

exports.handler = async function (event) {
	if (event.httpMethod !== 'POST') {
		return {
			statusCode: 405,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ error: 'Method not allowed' }),
		};
	}

	try {
		const payload = JSON.parse(event.body || '{}');
		const subject = String(payload.subject || 'Math').trim() || 'Math';
		const question = await generateQuizQuestion(subject);

		return {
			statusCode: 200,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(question),
		};
	} catch (error) {
		return {
			statusCode: 400,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ error: error.message || 'Quiz question generation failed' }),
		};
	}
};
