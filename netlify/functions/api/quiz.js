const { config } = require('dotenv');
config();

const { generateQuiz } = require('../../../engines');

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
		const count = Number(payload.count) || 5;
		const askedQuestions = Array.isArray(payload.askedQuestions) ? payload.askedQuestions : [];
		const questions = await generateQuiz(subject, count, askedQuestions);

		return {
			statusCode: 200,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(questions),
		};
	} catch (error) {
		return {
			statusCode: 400,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ error: error.message || 'Quiz generation failed' }),
		};
	}
};
