const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();
const API_KEY = process.env.OPENROUTER_API_KEY;

const headers = {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json"
};

const data = {
    model: "openrouter/free",
    messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Explain quantum computing simply." }
    ]
};

axios.post("https://openrouter.ai/api/v1/chat/completions", data, { headers })
    .then(res => console.log(res.data.choices[0].message.content))
    .catch(err => console.error(err));
