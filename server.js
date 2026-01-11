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

// Memória de Jobs e Estado
const activeJobs = new Map(); 
let currentRunningPromptId = null; 
let isComfyUIConnected = false; // Variável para rastrear o status do ComfyUI

// --- FUNÇÃO DE DOWNLOAD E SALVAMENTO ---
async function downloadAndSaveImage(filename, subfolder, type, promptId) {
    try {
        const fileUrl = `${COMFY_API_URL}/view?filename=${filename}&subfolder=${subfolder}&type=${type}`;
        const response = await axios({ url: fileUrl, method: 'GET', responseType: 'stream' });
        
        const baseName = `img_${Date.now()}_${promptId}`;
        const finalFilename = `${baseName}.png`;
        const jsonFilename = `${baseName}.json`;

        const savePath = path.join(GALLERY_DIR, finalFilename);
        const writer = fs.createWriteStream(savePath);
        
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                const job = activeJobs.get(promptId);
                
                // Salvar Metadados (JSON sidecar)
                if (job && job.metadata) {
                    const jsonPath = path.join(GALLERY_DIR, jsonFilename);
                    fs.writeFileSync(jsonPath, JSON.stringify(job.metadata, null, 2));
                }

                if (job) {
                    job.status = 'completed';
                    job.progress = 100;
                    job.outputUrl = `/gallery/${finalFilename}`;
                    job.filename = finalFilename;
                    activeJobs.set(promptId, job);

                    // Auto-limpeza
                    console.log(`[Servidor] Job ${promptId} concluído.`);
                    setTimeout(() => {
                        activeJobs.delete(promptId);
                    }, 5000); // 5 segundos para garantir que o front pegue a atualização
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

    ws.on('open', () => {
        console.log('[Servidor] Conectado ao ComfyUI');
        isComfyUIConnected = true; // Atualiza status para conectado
    });
    
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

                    // Tenta encontrar a imagem em diferentes nós de saída comuns
                    if (outputs["100"]?.images?.[0]) imageInfo = outputs["100"].images[0];
                    else if (outputs["9"]?.images?.[0]) imageInfo = outputs["9"].images[0];
                    else if (outputs["48"]?.images?.[0]) imageInfo = outputs["48"].images[0];
                    else {
                        // Fallback genérico: pega o primeiro nó que tenha imagens
                        const keys = Object.keys(outputs);
                        for (const key of keys) {
                            if (outputs[key].images && outputs[key].images.length > 0) {
                                imageInfo = outputs[key].images[0];
                                break;
                            }
                        }
                    }

                    if (imageInfo) {
                        await downloadAndSaveImage(imageInfo.filename, imageInfo.subfolder, imageInfo.type, promptId);
                    } else {
                        // Job sem imagem
                        const job = activeJobs.get(promptId);
                        job.status = 'completed';
                        job.progress = 100;
                        activeJobs.set(promptId, job);
                        setTimeout(() => activeJobs.delete(promptId), 5000);
                    }
                }
            }
        } catch (e) {
            // Ignora erros de parse irrelevantes
        }
    });

    ws.on('close', () => {
        console.log('[Servidor] Desconectado do ComfyUI. Tentando reconectar...');
        isComfyUIConnected = false; // Atualiza status para desconectado
        setTimeout(connectToComfyWS, 5000);
    });
    
    ws.on('error', (err) => {
        console.error('[Servidor] Erro no WebSocket:', err.message);
        isComfyUIConnected = false; // Atualiza status para desconectado
    });
}

connectToComfyWS();

// --- API ROUTES ---

// Nova rota para verificar status da conexão com ComfyUI
app.get('/api/status', (req, res) => {
    res.json({ connected: isComfyUIConnected });
});

// 1. Gerar
app.post('/api/generate', async (req, res) => {
    try {
        const { prompt, metadata } = req.body;
        
        // Envia para o ComfyUI
        const response = await axios.post(`${COMFY_API_URL}/prompt`, {
            client_id: "server_node_manager",
            prompt: prompt
        });

        const promptId = response.data.prompt_id;
        
        // Salva na memória com os metadados recebidos do front
        activeJobs.set(promptId, { 
            id: promptId, 
            status: 'pending', 
            progress: 0,
            startTime: Date.now(),
            metadata: metadata || {} 
        });

        res.json({ success: true, prompt_id: promptId });
    } catch (error) {
        console.error("Erro ao solicitar geração:", error.message);
        res.status(500).json({ error: "Erro no ComfyUI", details: error.message });
    }
});

// 2. Fila
app.get('/api/queue', (req, res) => {
    const queue = Array.from(activeJobs.values()).sort((a, b) => b.startTime - a.startTime);
    res.json(queue);
});

// 3. Galeria (Lê PNGs e JSONs)
app.get('/api/gallery', (req, res) => {
    fs.readdir(GALLERY_DIR, (err, files) => {
        if (err) return res.json([]);
        
        const images = files
            .filter(f => f.toLowerCase().endsWith('.png'))
            .map(f => {
                const filePath = path.join(GALLERY_DIR, f);
                let meta = {};
                
                // Tenta ler o JSON correspondente
                try {
                    const jsonPath = path.join(GALLERY_DIR, f.replace('.png', '.json'));
                    if (fs.existsSync(jsonPath)) {
                        const rawData = fs.readFileSync(jsonPath, 'utf-8');
                        meta = JSON.parse(rawData);
                    }
                } catch (e) {}

                return {
                    filename: f,
                    url: `/gallery/${f}`,
                    time: fs.statSync(filePath).mtime.getTime(),
                    // Espalha metadados (positive, negative, seed, etc) no objeto
                    ...meta 
                };
            })
            .sort((a, b) => b.time - a.time);
            
        res.json(images);
    });
});

// 4. Deletar Único
app.delete('/api/image/:filename', (req, res) => {
    const filename = req.params.filename;
    const pngPath = path.join(GALLERY_DIR, filename);
    const jsonPath = path.join(GALLERY_DIR, filename.replace('.png', '.json'));

    try {
        if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
        if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Erro ao excluir arquivo" });
    }
});

// 5. Deletar em Lote
app.post('/api/image/batch-delete', (req, res) => {
    const { filenames } = req.body;
    if (!Array.isArray(filenames)) return res.status(400).json({ error: "Lista inválida" });

    let deletedCount = 0;
    
    filenames.forEach(filename => {
        const pngPath = path.join(GALLERY_DIR, filename);
        const jsonPath = path.join(GALLERY_DIR, filename.replace('.png', '.json'));
        
        try {
            if (fs.existsSync(pngPath)) {
                fs.unlinkSync(pngPath);
                deletedCount++;
            }
            if (fs.existsSync(jsonPath)) {
                fs.unlinkSync(jsonPath);
            }
        } catch (e) {
            console.error(`Falha ao deletar ${filename}:`, e.message);
        }
    });

    res.json({ success: true, count: deletedCount });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor NodeStation rodando em http://localhost:${PORT}`);
});