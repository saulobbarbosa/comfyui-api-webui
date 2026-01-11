const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const WebSocket = require('ws');

const app = express();
const PORT = 3000;

// CONFIGURAÇÃO DO COMFYUI
const COMFY_API_URL = "http://127.0.0.1:8188"; 
const COMFY_WS_URL = "ws://127.0.0.1:8188/ws";

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('public'));
app.use('/gallery', express.static('gallery'));

const GALLERY_DIR = path.join(__dirname, 'gallery');
if (!fs.existsSync(GALLERY_DIR)) fs.mkdirSync(GALLERY_DIR);

// Memória de Jobs
const activeJobs = new Map(); 
let currentRunningPromptId = null; 

// --- FUNÇÃO DE DOWNLOAD ---
async function downloadAndSaveImage(filename, subfolder, type, promptId) {
    try {
        const fileUrl = `${COMFY_API_URL}/view?filename=${filename}&subfolder=${subfolder}&type=${type}`;
        const response = await axios({ url: fileUrl, method: 'GET', responseType: 'stream' });
        
        const finalFilename = `img_${Date.now()}_${promptId}.png`;
        const savePath = path.join(GALLERY_DIR, finalFilename);
        const writer = fs.createWriteStream(savePath);
        
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                const job = activeJobs.get(promptId);
                if (job) {
                    job.status = 'completed';
                    job.progress = 100;
                    job.outputUrl = `/gallery/${finalFilename}`;
                    job.filename = finalFilename;
                    activeJobs.set(promptId, job);

                    // --- MODIFICAÇÃO: AUTO-LIMPEZA ---
                    // Remove da fila após 3 segundos para dar tempo do usuário ver "Pronto"
                    console.log(`[Servidor] Job ${promptId} concluído. Removendo da fila em 3s...`);
                    setTimeout(() => {
                        activeJobs.delete(promptId);
                    }, 3000);
                }
                resolve(finalFilename);
            });
            writer.on('error', reject);
        });
    } catch (e) {
        console.error("Erro ao baixar imagem:", e.message);
    }
}

// --- WEBSOCKET LISTENER ---
function connectToComfyWS() {
    const clientId = "server_node_manager";
    const ws = new WebSocket(`${COMFY_WS_URL}?clientId=${clientId}`);

    ws.on('open', () => console.log('[Servidor] Conectado ao ComfyUI'));
    
    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);
            
            // 1. Geração Iniciou
            if (msg.type === 'execution_start') {
                const promptId = msg.data.prompt_id;
                currentRunningPromptId = promptId;
                
                if (activeJobs.has(promptId)) {
                    const job = activeJobs.get(promptId);
                    job.status = 'processing';
                    job.progress = 0;
                    activeJobs.set(promptId, job);
                }
            }
            
            // 2. Progresso
            if (msg.type === 'progress') {
                const { value, max } = msg.data;
                if (currentRunningPromptId && activeJobs.has(currentRunningPromptId)) {
                    const job = activeJobs.get(currentRunningPromptId);
                    job.progress = Math.round((value / max) * 100);
                    activeJobs.set(currentRunningPromptId, job);
                }
            }

            // 3. Geração Finalizada
            if (msg.type === 'execution_success') {
                const promptId = msg.data.prompt_id;
                currentRunningPromptId = null; 
                
                if (activeJobs.has(promptId)) {
                    // Busca imagem
                    const historyRes = await axios.get(`${COMFY_API_URL}/history/${promptId}`);
                    const outputs = historyRes.data[promptId].outputs;
                    let imageInfo = null;

                    if (outputs["100"]?.images?.[0]) imageInfo = outputs["100"].images[0];
                    else if (outputs["9"]?.images?.[0]) imageInfo = outputs["9"].images[0];
                    else if (outputs["48"]?.images?.[0]) imageInfo = outputs["48"].images[0];
                    else {
                        const keys = Object.keys(outputs);
                        if (keys.length > 0 && outputs[keys[0]].images) 
                            imageInfo = outputs[keys[0]].images[0];
                    }

                    if (imageInfo) {
                        await downloadAndSaveImage(imageInfo.filename, imageInfo.subfolder, imageInfo.type, promptId);
                    } else {
                        // Caso não tenha imagem (só processamento), remove também
                        const job = activeJobs.get(promptId);
                        job.status = 'completed';
                        job.progress = 100;
                        activeJobs.set(promptId, job);
                        
                        // Auto-limpeza também para jobs sem imagem
                        setTimeout(() => {
                            activeJobs.delete(promptId);
                        }, 3000);
                    }
                }
            }
        } catch (e) {}
    });

    ws.on('close', () => setTimeout(connectToComfyWS, 5000));
}

connectToComfyWS();

// --- API ROUTES ---
app.post('/api/generate', async (req, res) => {
    try {
        const { prompt } = req.body;
        const response = await axios.post(`${COMFY_API_URL}/prompt`, {
            client_id: "server_node_manager",
            prompt: prompt
        });

        const promptId = response.data.prompt_id;
        
        activeJobs.set(promptId, { 
            id: promptId, 
            status: 'pending', 
            progress: 0,
            startTime: Date.now() 
        });

        res.json({ success: true, prompt_id: promptId });
    } catch (error) {
        res.status(500).json({ error: "Erro no ComfyUI", details: error.message });
    }
});

app.get('/api/queue', (req, res) => {
    const queue = Array.from(activeJobs.values()).sort((a, b) => b.startTime - a.startTime);
    res.json(queue);
});

app.get('/api/gallery', (req, res) => {
    fs.readdir(GALLERY_DIR, (err, files) => {
        if (err) return res.json([]);
        const images = files
            .filter(f => f.endsWith('.png'))
            .map(f => ({
                filename: f,
                url: `/gallery/${f}`,
                time: fs.statSync(path.join(GALLERY_DIR, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);
        res.json(images);
    });
});

app.delete('/api/image/:filename', (req, res) => {
    const filePath = path.join(GALLERY_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Não encontrado" });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});