const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const WebSocket = require('ws');

const app = express();
const PORT = 3000;

// CONFIGURAÇÃO DO COMFYUI (Dinâmica)
// Default Zrok address, pode ser alterado via API
let COMFY_API_URL = "https://5uruggdvp6an.share.zrok.io"; 
let COMFY_WS_URL = "wss://5uruggdvp6an.share.zrok.io/ws";

// CONFIGURAÇÃO AXIOS PARA ZROK
axios.defaults.headers.common['skip_zrok_interstitial'] = '1';

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('public'));
app.use('/gallery', express.static('gallery'));

const GALLERY_DIR = path.join(__dirname, 'gallery');
if (!fs.existsSync(GALLERY_DIR)) fs.mkdirSync(GALLERY_DIR);

// Memória de Jobs e Estado
const activeJobs = new Map(); 
let currentRunningPromptId = null; 
let isComfyUIConnected = false; 
let wsConnection = null;

// --- FUNÇÃO AUXILIAR PARA SALVAR METADADOS E FINALIZAR ---
function finalizeJob(promptId, filename, job) {
    if (!job) return;

    // Salvar Metadados (JSON sidecar)
    if (job.metadata) {
        const jsonFilename = filename.replace('.png', '.json');
        const jsonPath = path.join(GALLERY_DIR, jsonFilename);
        try {
            fs.writeFileSync(jsonPath, JSON.stringify(job.metadata, null, 2));
        } catch (e) {
            console.error(`[Servidor] Erro ao salvar metadados para ${promptId}:`, e);
        }
    }

    job.status = 'completed';
    job.progress = 100;
    job.outputUrl = `/gallery/${filename}`;
    job.filename = filename;
    activeJobs.set(promptId, job);

    console.log(`[Servidor] Job ${promptId} concluído (Imagem Recebida).`);
    
    // Auto-limpeza da memória após 10s (aumentado para garantir que o front pegue)
    setTimeout(() => {
        if (activeJobs.has(promptId)) {
            activeJobs.delete(promptId);
        }
    }, 10000);
}

// --- WEBSOCKET LISTENER ---
function connectToComfyWS() {
    // Se já existir conexão anterior, fecha
    if (wsConnection) {
        try { 
            wsConnection.terminate(); 
            console.log('[Servidor] Fechando conexão WS anterior...');
        } catch(e){}
    }

    const clientId = "server_node_manager";
    const wsOptions = { headers: { 'skip_zrok_interstitial': '1' } };

    console.log(`[Servidor] Tentando conectar WebSocket em: ${COMFY_WS_URL}`);
    
    try {
        const ws = new WebSocket(`${COMFY_WS_URL}?clientId=${clientId}`, wsOptions);
        wsConnection = ws;

        ws.on('open', () => {
            console.log('[Servidor] Conectado ao ComfyUI');
            isComfyUIConnected = true; 
        });
        
        ws.on('message', async (data, isBinary) => {
            // --- 1. TRATAMENTO DE IMAGEM BINÁRIA (SaveImageWebsocket) ---
            if (isBinary) {
                // Se recebermos um binário, assumimos que é para o prompt atual
                // mesmo que currentRunningPromptId tenha sido limpo (o que tentaremos evitar na lógica JSON)
                
                // Fallback: Se currentRunningPromptId for null, tentamos pegar o job mais recente que ainda está 'processing'
                let targetPromptId = currentRunningPromptId;
                
                if (!targetPromptId) {
                    // Procura o job mais recente em processamento
                    for (let [pid, job] of activeJobs) {
                        if (job.status === 'processing') {
                            targetPromptId = pid;
                            break; // Assume o primeiro encontrado (fifo ou lifo dependendo da iteração, Map preserva ordem de inserção)
                        }
                    }
                }

                if (targetPromptId && activeJobs.has(targetPromptId)) {
                    try {
                        // Ignora os primeiros 8 bytes (cabeçalho do protocolo ComfyUI: type(4) + format(4))
                        const imageBuffer = data.subarray(8); 
                        
                        const baseName = `img_${Date.now()}_${targetPromptId}`;
                        const finalFilename = `${baseName}.png`;
                        const savePath = path.join(GALLERY_DIR, finalFilename);

                        fs.writeFileSync(savePath, imageBuffer);

                        const job = activeJobs.get(targetPromptId);
                        finalizeJob(targetPromptId, finalFilename, job);
                        
                        // Limpa o ID atual já que o trabalho principal foi feito
                        if (currentRunningPromptId === targetPromptId) {
                            currentRunningPromptId = null;
                        }
                    } catch (err) {
                        console.error("[Servidor] Erro ao salvar imagem via WebSocket:", err);
                    }
                } else {
                    console.warn("[Servidor] Imagem binária recebida mas nenhum Job ativo encontrado.");
                }
                return;
            }

            // --- 2. TRATAMENTO DE MENSAGENS JSON ---
            try {
                const msg = JSON.parse(data.toString());
                
                if (msg.type === 'execution_start') {
                    const promptId = msg.data.prompt_id;
                    currentRunningPromptId = promptId;
                    console.log(`[Servidor] Execução iniciada: ${promptId}`);
                    
                    if (activeJobs.has(promptId)) {
                        const job = activeJobs.get(promptId);
                        job.status = 'processing';
                        job.progress = 0;
                        activeJobs.set(promptId, job);
                    }
                }
                
                if (msg.type === 'progress') {
                    const { value, max } = msg.data;
                    // Atualiza o progresso do job atual
                    if (currentRunningPromptId && activeJobs.has(currentRunningPromptId)) {
                        const job = activeJobs.get(currentRunningPromptId);
                        job.progress = Math.round((value / max) * 100);
                        activeJobs.set(currentRunningPromptId, job);
                    }
                }

                if (msg.type === 'execution_success') {
                    const promptId = msg.data.prompt_id;
                    console.log(`[Servidor] Execução reportada como sucesso: ${promptId}`);

                    // NÃO finaliza imediatamente se estivermos esperando uma imagem via websocket.
                    // O nó SaveImageWebsocket envia a imagem, e o execution_success vem logo depois (ou antes, dependendo da rede).
                    // Vamos dar um tempo de tolerância para a imagem chegar.
                    
                    setTimeout(() => {
                        if (activeJobs.has(promptId)) {
                            const job = activeJobs.get(promptId);
                            
                            // Se após o timeout o status ainda não for completed, significa que a imagem não chegou/não foi processada
                            if (job.status !== 'completed') {
                                console.log(`[Servidor] Aviso: Job ${promptId} finalizou sucesso, mas imagem não chegou no tempo limite.`);
                                // Finaliza o job para liberar a UI, mesmo sem imagem
                                job.status = 'completed'; 
                                job.progress = 100;
                                activeJobs.set(promptId, job);
                                setTimeout(() => activeJobs.delete(promptId), 5000);
                            }
                        }
                        
                        // Limpa o ponteiro global se ainda estiver apontando para este job
                        if (currentRunningPromptId === promptId) {
                            currentRunningPromptId = null;
                        }
                    }, 3000); // 3 segundos de tolerância para a imagem binária chegar
                }
            } catch (e) {
                // Erros de parse JSON são esperados em pings ou outros dados, ignoramos silenciosamente na maioria dos casos
            }
        });

        ws.on('close', () => {
            console.log('[Servidor] WebSocket desconectado.');
            isComfyUIConnected = false;
            wsConnection = null;
            setTimeout(connectToComfyWS, 5000);
        });
        
        ws.on('error', (err) => {
            console.error('[Servidor] Erro no WebSocket:', err.message);
            isComfyUIConnected = false;
        });

    } catch (error) {
        console.error('[Servidor] Falha ao iniciar WebSocket:', error.message);
        setTimeout(connectToComfyWS, 5000);
    }
}

connectToComfyWS();

// --- API ROUTES ---

// Config Endpoint: Ler URL atual
app.get('/api/config', (req, res) => {
    res.json({ url: COMFY_API_URL });
});

// Config Endpoint: Atualizar URL
app.post('/api/config', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL inválida" });

    // Atualiza variaveis globais
    COMFY_API_URL = url.replace(/\/$/, ""); // Remove barra final se houver
    
    // Deriva WS URL (http -> ws, https -> wss)
    if (COMFY_API_URL.startsWith("https")) {
        COMFY_WS_URL = COMFY_API_URL.replace("https://", "wss://") + "/ws";
    } else {
        COMFY_WS_URL = COMFY_API_URL.replace("http://", "ws://") + "/ws";
    }

    console.log(`[Config] URLs alteradas para: API=${COMFY_API_URL}, WS=${COMFY_WS_URL}`);

    // Força reconexão WebSocket
    connectToComfyWS();

    res.json({ success: true, api: COMFY_API_URL, ws: COMFY_WS_URL });
});

app.get('/api/status', (req, res) => {
    res.json({ connected: isComfyUIConnected });
});

// 1. Gerar
app.post('/api/generate', async (req, res) => {
    try {
        const { prompt, metadata } = req.body;
        
        console.log('[API] Solicitando geração...');
        const response = await axios.post(`${COMFY_API_URL}/prompt`, {
            client_id: "server_node_manager",
            prompt: prompt
        });

        const promptId = response.data.prompt_id;
        console.log(`[API] Geração iniciada com ID: ${promptId}`);
        
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

// 3. Galeria
app.get('/api/gallery', (req, res) => {
    fs.readdir(GALLERY_DIR, (err, files) => {
        if (err) return res.json([]);
        
        const images = files
            .filter(f => f.toLowerCase().endsWith('.png'))
            .map(f => {
                const filePath = path.join(GALLERY_DIR, f);
                let meta = {};
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