const API_BASE = window.location.origin;

const els = {
    statusIndicator: document.getElementById('connectionStatus'),
    generateBtn: document.getElementById('generateBtn'),
    
    // LoRA 
    activeLorasContainer: document.getElementById('activeLorasContainer'),
    addLoraRowBtn: document.getElementById('addLoraRowBtn'),
    manageLorasBtn: document.getElementById('manageLorasBtn'),
    loraModal: document.getElementById('loraModal'),
    closeLoraModalBtn: document.getElementById('closeLoraModalBtn'),
    newLoraInput: document.getElementById('newLoraInput'),
    addLoraBtn: document.getElementById('addLoraBtn'),
    loraManagementList: document.getElementById('loraManagementList'),

    positivePrompt: document.getElementById('positivePrompt'),
    negativePrompt: document.getElementById('negativePrompt'),
    widthInput: document.getElementById('widthInput'),
    heightInput: document.getElementById('heightInput'),
    
    // Controle de Upscale
    upscaleInput: document.getElementById('upscaleInput'),
    upscaleValueDisplay: document.getElementById('upscaleValueDisplay'),

    seedInput: document.getElementById('seedInput'),
    randomSeedBtn: document.getElementById('randomSeedBtn'),
    resultImage: document.getElementById('resultImage'),
    placeholder: document.getElementById('placeholder'),
    progressOverlay: document.getElementById('progressOverlay'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    galleryGrid: document.getElementById('galleryGrid'),
    imageActions: document.getElementById('imageActions'),
    closeImgBtn: document.getElementById('closeImgBtn'),
    deleteImgBtn: document.getElementById('deleteImgBtn'),
    infoImgBtn: document.getElementById('infoImgBtn'), 
    queueList: document.getElementById('queueList'),
    toggleSelectModeBtn: document.getElementById('toggleSelectModeBtn'),
    deleteBatchBtn: document.getElementById('deleteBatchBtn'),
    selectedCount: document.getElementById('selectedCount'),
    
    // Configurações ComfyUI
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    cancelSettingsAction: document.getElementById('cancelSettingsAction'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    comfyUrlInput: document.getElementById('comfyUrlInput'),
    serverAddressDisplay: document.getElementById('serverAddressDisplay'),

    // Pesquisa
    searchInput: document.getElementById('searchInput'),

    // Toggle Galeria
    toggleGalleryBtn: document.getElementById('toggleGalleryBtn'),
    mainContent: document.querySelector('.main-content')
};

// Estado da Aplicação
let lastGallerySignature = '';
let currentImageData = null; 
let isSelectionMode = false;
let selectedImages = new Set();
let allGalleryImages = []; 
let availableLoras = []; 

// Tratamento de Erro Global
window.onerror = function(message, source, lineno, colno, error) {
    console.error("Erro global:", message);
    return false;
};

// --- Inicialização ---
function init() {
    setupEventListeners();
    
    // Inicia com a galeria oculta por padrão
    toggleGallery();

    checkConnection();
    updateGallery(); 
    updateQueue();
    fetchConfig(); 
    fetchLoras(); // Carrega os LoRAs salvos globalmente

    // Polling a cada 1 segundo
    setInterval(() => {
        checkConnection();
        updateQueue();
        if (!isSelectionMode) { 
            updateGallery(); 
        }
    }, 1000);
}

// --- Gerenciamento de LoRAs ---
async function fetchLoras() {
    try {
        const res = await fetch(`${API_BASE}/api/loras`);
        if (res.ok) {
            availableLoras = await res.json();
            updateAllLoraSelects();
            renderLoraManagementList(availableLoras);
        }
    } catch (e) { console.error("Falha ao buscar LoRAs", e); }
}

function updateAllLoraSelects() {
    const selects = document.querySelectorAll('.lora-select');
    selects.forEach(select => {
        const currentValue = select.value;
        select.innerHTML = '<option value="none">Nenhum</option>';
        availableLoras.forEach(lora => {
            const option = document.createElement('option');
            option.value = lora;
            option.textContent = lora;
            select.appendChild(option);
        });
        if (availableLoras.includes(currentValue) || currentValue === 'none') {
            select.value = currentValue;
        }
    });
}

function createLoraRow() {
    const row = document.createElement('div');
    row.className = 'lora-row';
    
    const header = document.createElement('div');
    header.className = 'lora-row-header';
    
    const select = document.createElement('select');
    select.className = 'custom-select lora-select';
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-lora-btn';
    removeBtn.innerHTML = '<span class="material-icons">delete</span>';
    removeBtn.title = "Remover LoRA";
    removeBtn.onclick = (e) => {
        e.preventDefault();
        row.remove();
    };
    
    header.appendChild(select);
    header.appendChild(removeBtn);
    
    const weightContainer = document.createElement('div');
    weightContainer.className = 'lora-weight-control';
    
    const label = document.createElement('label');
    label.innerText = 'Força';
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'slider lora-weight-slider';
    slider.min = '-2.0';
    slider.max = '2.0';
    slider.step = '0.05';
    slider.value = '1.0';
    
    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.className = 'lora-weight-number';
    numberInput.min = '-2.0';
    numberInput.max = '2.0';
    numberInput.step = '0.05';
    numberInput.value = '1.0';
    
    slider.oninput = () => numberInput.value = slider.value;
    numberInput.oninput = () => slider.value = numberInput.value;
    
    weightContainer.appendChild(label);
    weightContainer.appendChild(slider);
    weightContainer.appendChild(numberInput);
    
    row.appendChild(header);
    row.appendChild(weightContainer);
    
    els.activeLorasContainer.appendChild(row);
    
    select.innerHTML = '<option value="none">Nenhum</option>';
    availableLoras.forEach(lora => {
        const option = document.createElement('option');
        option.value = lora;
        option.textContent = lora;
        select.appendChild(option);
    });
}

function renderLoraManagementList(loras) {
    els.loraManagementList.innerHTML = '';
    
    if (loras.length === 0) {
        els.loraManagementList.innerHTML = '<p style="color: #666; font-size: 0.85rem;">Nenhum LoRA salvo.</p>';
        return;
    }

    loras.forEach(lora => {
        const item = document.createElement('div');
        item.className = 'lora-item';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = lora;
        
        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn-plain';
        delBtn.style.color = 'var(--error)';
        delBtn.innerHTML = '<span class="material-icons" style="font-size: 1.1rem;">delete</span>';
        delBtn.onclick = () => deleteLora(lora);

        item.appendChild(nameSpan);
        item.appendChild(delBtn);
        els.loraManagementList.appendChild(item);
    });
}

async function addLora() {
    const name = els.newLoraInput.value.trim();
    if (!name) return;

    try {
        const res = await fetch(`${API_BASE}/api/loras`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        
        if (res.ok) {
            els.newLoraInput.value = '';
            fetchLoras(); // Atualiza a lista
        }
    } catch (e) {
        console.error("Erro ao adicionar LoRA", e);
    }
}

async function deleteLora(name) {
    try {
        const res = await fetch(`${API_BASE}/api/loras/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
        
        if (res.ok) {
            fetchLoras(); // Atualiza a lista
        }
    } catch (e) {
        console.error("Erro ao deletar LoRA", e);
    }
}

function openLoraModal() {
    fetchLoras();
    els.loraModal.classList.remove('hidden');
}

function closeLoraModal() {
    els.loraModal.classList.add('hidden');
}


// --- Configurações & Conexão ---
async function fetchConfig() {
    try {
        const res = await fetch(`${API_BASE}/api/config`);
        if (res.ok) {
            const data = await res.json();
            els.comfyUrlInput.value = data.url;
            els.serverAddressDisplay.innerText = `Conectado a ${data.url}`;
        }
    } catch (e) { console.error("Falha ao buscar config", e); }
}

async function saveConfig() {
    const newUrl = els.comfyUrlInput.value.trim();
    if (!newUrl) return;

    try {
        const res = await fetch(`${API_BASE}/api/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: newUrl })
        });
        
        if (res.ok) {
            const data = await res.json();
            els.serverAddressDisplay.innerText = `Conectado a ${data.api}`;
            closeSettings();
            Swal.fire({
                icon: 'success',
                title: 'Conexão Atualizada',
                text: 'URL do servidor alterada com sucesso.',
                timer: 1500,
                showConfirmButton: false,
                background: '#1e1e1e', color: '#fff'
            });
            checkConnection(); 
        } else {
            throw new Error('Falha na resposta do servidor');
        }
    } catch (e) {
        Swal.fire({
            icon: 'error',
            title: 'Erro',
            text: 'Não foi possível salvar a configuração.',
            background: '#1e1e1e', color: '#fff'
        });
    }
}

async function checkConnection() {
    try {
        const res = await fetch(`${API_BASE}/api/status`);
        if (res.ok) {
            const data = await res.json();
            setOnlineStatus(data.connected);
        } else {
            setOnlineStatus(false);
        }
    } catch (e) {
        setOnlineStatus(false);
    }
}

function setOnlineStatus(isOnline) {
    if (isOnline) {
        els.statusIndicator.classList.add('online');
        els.statusIndicator.title = "ComfyUI Conectado";
        if (!els.generateBtn.hasAttribute('data-clicked')) {
            els.generateBtn.disabled = false;
        }
    } else {
        els.statusIndicator.classList.remove('online');
        els.statusIndicator.title = "ComfyUI Desconectado ou Erro no Servidor";
        els.generateBtn.disabled = true;
    }
}

// --- Funções de UI Auxiliares ---
function openSettings() {
    fetchConfig(); 
    els.settingsModal.classList.remove('hidden');
}

function closeSettings() {
    els.settingsModal.classList.add('hidden');
}

function toggleSeedInput() {
    if (els.randomSeedBtn.checked) {
        els.seedInput.disabled = true;
        els.seedInput.value = '';
        els.seedInput.placeholder = "Aleatório";
    } else {
        els.seedInput.disabled = false;
        els.seedInput.placeholder = "Digite a seed...";
        els.seedInput.focus();
    }
}

function updateUpscaleDisplay() {
    const val = els.upscaleInput.value;
    els.upscaleValueDisplay.innerText = `${val}x`;
}

// --- ATUALIZAÇÃO DA GALERIA ---
async function updateGallery() {
    try {
        const response = await fetch(`${API_BASE}/api/gallery`);
        const images = await response.json();
        
        const newSignature = JSON.stringify(images.map(img => img.filename));
        allGalleryImages = images;

        if (newSignature === lastGallerySignature) {
            return; 
        }

        lastGallerySignature = newSignature;
        filterAndRenderGallery(); 

    } catch (e) { 
        console.error("Erro ao atualizar galeria", e); 
    }
}

function filterAndRenderGallery() {
    const query = els.searchInput.value.trim().toLowerCase();
    
    let filteredImages = allGalleryImages;

    if (query) {
        const tags = query.split(',').map(tag => tag.trim().replace(/_/g, ' ')).filter(t => t);
        
        filteredImages = allGalleryImages.filter(img => {
            const haystack = (img.positive || "") + " " + (img.filename || "");
            const haystackLower = haystack.toLowerCase();
            return tags.every(tag => haystackLower.includes(tag));
        });
    }

    renderGalleryGrid(filteredImages);
}

function renderGalleryGrid(images) {
    els.galleryGrid.innerHTML = ''; 
    
    if (images.length === 0) {
        const msg = els.searchInput.value ? 'Nenhuma imagem encontrada para esta pesquisa.' : 'Sem imagens';
        els.galleryGrid.innerHTML = `<p style="color:#666; width:100%; text-align:center; padding: 20px; grid-column: 1/-1;">${msg}</p>`;
        return;
    }

    images.forEach(imgData => {
        addToGallery(imgData);
    });
}

function addToGallery(imgData) {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    div.dataset.filename = imgData.filename;
    
    if (selectedImages.has(imgData.filename)) {
        div.classList.add('selected');
    }

    const img = document.createElement('img');
    img.src = imgData.url;
    img.loading = "lazy";
    
    div.onclick = () => {
        if (isSelectionMode) {
            toggleSelection(div, imgData.filename);
        } else {
            displayImage(imgData);
        }
    };
    
    div.appendChild(img);
    els.galleryGrid.appendChild(div);
}

// --- LÓGICA DE SELEÇÃO E EXCLUSÃO EM LOTE ---
function toggleSelectionMode() {
    isSelectionMode = !isSelectionMode;
    selectedImages.clear();
    updateSelectionUI();
    
    if (isSelectionMode) {
        const btnIcon = els.toggleSelectModeBtn.querySelector('.material-icons');
        const btnLabel = els.toggleSelectModeBtn.querySelector('.btn-label');
        if(btnIcon) btnIcon.innerText = 'close';
        if(btnLabel) btnLabel.innerText = 'Cancelar';
        els.toggleSelectModeBtn.style.color = 'var(--text-main)';
    } else {
        const btnIcon = els.toggleSelectModeBtn.querySelector('.material-icons');
        const btnLabel = els.toggleSelectModeBtn.querySelector('.btn-label');
        if(btnIcon) btnIcon.innerText = 'check_box';
        if(btnLabel) btnLabel.innerText = 'Selecionar';
        els.toggleSelectModeBtn.style.color = '';
        document.querySelectorAll('.gallery-item.selected').forEach(el => el.classList.remove('selected'));
        filterAndRenderGallery();
    }
}

function toggleSelection(element, filename) {
    if (selectedImages.has(filename)) {
        selectedImages.delete(filename);
        element.classList.remove('selected');
    } else {
        selectedImages.add(filename);
        element.classList.add('selected');
    }
    updateSelectionUI();
}

function updateSelectionUI() {
    els.selectedCount.innerText = selectedImages.size;
    if (selectedImages.size > 0) {
        els.deleteBatchBtn.classList.remove('hidden');
    } else {
        els.deleteBatchBtn.classList.add('hidden');
    }
}

async function deleteBatchImages() {
    if (selectedImages.size === 0) return;

    const result = await Swal.fire({
        title: 'Tem certeza?',
        text: `Você vai excluir ${selectedImages.size} imagens permanentemente!`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sim, excluir!',
        cancelButtonText: 'Cancelar',
        background: '#1e1e1e',
        color: '#fff'
    });

    if (result.isConfirmed) {
        try {
            await fetch(`${API_BASE}/api/image/batch-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filenames: Array.from(selectedImages) })
            });

            Swal.fire({
                title: 'Excluído!',
                text: 'As imagens foram removidas.',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false,
                background: '#1e1e1e', color: '#fff'
            });

            toggleSelectionMode();
            lastGallerySignature = "";
            updateGallery();
            closeImage(); // Fecha caso alguma imagem afetada estivesse aberta

        } catch (e) {
            Swal.fire({
                icon: 'error',
                title: 'Erro',
                text: 'Falha ao excluir imagens.',
                background: '#1e1e1e', color: '#fff'
            });
        }
    }
}

async function cancelJob(promptId) {
    if (!promptId) return;

    const result = await Swal.fire({
        title: 'Cancelar Job?',
        text: "Deseja interromper a geração desta imagem?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#cf6679',
        cancelButtonColor: '#666',
        confirmButtonText: 'Sim, cancelar',
        cancelButtonText: 'Não',
        background: '#1e1e1e',
        color: '#fff',
        width: '300px'
    });

    if (result.isConfirmed) {
        try {
            const res = await fetch(`${API_BASE}/api/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ promptId })
            });
            
            if (res.ok) {
                const toast = Swal.mixin({
                    toast: true, position: 'top-end', showConfirmButton: false, timer: 2000, background: '#1e1e1e', color: '#fff'
                });
                toast.fire({ icon: 'success', title: 'Job cancelado' });
                updateQueue();
            } else {
                throw new Error("Erro no servidor");
            }
        } catch (e) {
            Swal.fire({
                icon: 'error',
                title: 'Erro',
                text: 'Não foi possível cancelar o job.',
                background: '#1e1e1e', color: '#fff'
            });
        }
    }
}

async function updateQueue() {
    try {
        const res = await fetch(`${API_BASE}/api/queue`);
        if (!res.ok) return;
        const queue = await res.json();
        renderQueue(queue);
    } catch (e) {
        console.error("Erro ao buscar fila", e);
    }
}

function renderQueue(queueData) {
    els.queueList.innerHTML = '';

    if (queueData.length === 0) {
        els.queueList.innerHTML = '<div style="color:var(--text-muted); padding:10px; text-align:center; font-size:0.8rem;">Fila vazia</div>';
        els.progressOverlay.classList.add('hidden');
        return;
    }

    let somethingProcessing = false;

    queueData.forEach(job => {
        const item = document.createElement('div');
        item.className = `queue-item ${job.status}`;
        if (job.status === 'processing') item.classList.add('active');

        let statusText = 'Na Fila';
        
        if (job.status === 'processing') {
            statusText = job.currentStep || 'Gerando...';
        }
        if (job.status === 'completed') statusText = 'Pronto';

        const header = document.createElement('div');
        header.className = "queue-header";
        
        const infoSpan = document.createElement('span');
        infoSpan.className = "queue-id";
        infoSpan.innerText = `Job #${job.id.substring(0,6)}`;
        header.appendChild(infoSpan);

        const statusGroup = document.createElement('div');
        statusGroup.style.display = 'flex';
        statusGroup.style.alignItems = 'center';
        statusGroup.style.gap = '8px';

        const statusBadge = document.createElement('span');
        statusBadge.className = "queue-status";
        statusBadge.innerText = statusText;
        statusGroup.appendChild(statusBadge);

        if (job.status !== 'completed') {
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'queue-cancel-btn';
            cancelBtn.innerHTML = '<span class="material-icons" style="font-size: 14px;">close</span>';
            cancelBtn.title = "Cancelar Job";
            cancelBtn.onclick = (e) => {
                e.stopPropagation();
                cancelJob(job.id);
            };
            statusGroup.appendChild(cancelBtn);
        }
        header.appendChild(statusGroup);
        item.appendChild(header);

        const barBg = document.createElement('div');
        barBg.className = "queue-mini-bar-bg";
        const barFill = document.createElement('div');
        barFill.className = "queue-mini-bar-fill";
        barFill.style.width = `${job.progress}%`;
        barBg.appendChild(barFill);
        item.appendChild(barBg);

        if (job.status === 'completed') {
            if (job.outputUrl) {
                item.style.cursor = 'pointer';
                item.title = "Clique para visualizar";
                const meta = { 
                    url: job.outputUrl, 
                    filename: job.filename,
                    positive: job.metadata?.positive,
                    negative: job.metadata?.negative,
                    seed: job.metadata?.seed,
                    width: job.metadata?.width,
                    height: job.metadata?.height,
                    upscale: job.metadata?.upscale,
                    lora: job.metadata?.lora
                };
                item.onclick = () => displayImage(meta);
            } else {
                item.style.opacity = "0.5";
                item.title = "Erro: Imagem não recebida";
                if(statusBadge) {
                    statusBadge.innerText = "Erro/Timeout";
                    statusBadge.style.color = "#cf6679";
                }
            }
        }

        if (job.status === 'processing') {
            somethingProcessing = true;
            els.progressOverlay.classList.remove('hidden');
            els.progressBar.style.width = `${job.progress}%`;
            els.progressText.innerText = `${job.progress}%`;
        }

        els.queueList.appendChild(item);
    });

    if (!somethingProcessing) {
        els.progressOverlay.classList.add('hidden');
    }
}

// --- GERAÇÃO DE IMAGEM ---
els.generateBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    if(!els.positivePrompt.value.trim()) {
        Swal.fire({ icon: 'warning', title: 'Atenção', text: 'O prompt positivo não pode estar vazio.', background: '#1e1e1e', color: '#fff' });
        return;
    }

    els.generateBtn.disabled = true;
    els.generateBtn.setAttribute('data-clicked', 'true');
    setTimeout(() => {
        els.generateBtn.disabled = false;
        els.generateBtn.removeAttribute('data-clicked');
    }, 1000);

    // --- INPUTS ---
    let seed;
    if (els.randomSeedBtn.checked) {
        seed = Math.floor(Math.random() * 10000000000);
    } else {
        seed = parseInt(els.seedInput.value);
        if (isNaN(seed)) {
            seed = Math.floor(Math.random() * 10000000000);
        }
    }

    const upscaleLevel = parseFloat(els.upscaleInput.value); 
    const width = parseInt(els.widthInput.value) || 1024;
    const height = parseInt(els.heightInput.value) || 1024;
    const positive = els.positivePrompt.value;
    const negative = els.negativePrompt.value;
    const activeLoras = [];
    const loraRows = document.querySelectorAll('.lora-row');
    loraRows.forEach(row => {
        const loraName = row.querySelector('.lora-select').value;
        const loraWeight = parseFloat(row.querySelector('.lora-weight-slider').value) || 1.0;
        if (loraName && loraName !== 'none') {
            activeLoras.push({ name: loraName, weight: loraWeight });
        }
    });

    // --- CONSTRUÇÃO DO WORKFLOW ---
    const promptFlow = {};
    
    // 1. Checkpoint Loader
    promptFlow["1"] = { 
        inputs: { ckpt_name: "WAI_NFSW.safetensors" }, 
        class_type: "CheckpointLoaderSimple" 
    };

    // 5. CLIP Set Last Layer
    promptFlow["5"] = {
        inputs: { stop_at_clip_layer: -2, clip: ["1", 1] },
        class_type: "CLIPSetLastLayer"
    };

    // --- LÓGICA DO LORA ---
    let modelSource = ["1", 0]; // Padrão: Checkpoint
    
    // Nós para múltiplos LoRAs começam do id 100
    let currentLoraNodeId = 100;
    
    activeLoras.forEach(lora => {
        const nodeId = currentLoraNodeId.toString();
        promptFlow[nodeId] = {
            inputs: {
                lora_name: lora.name,
                strength_model: lora.weight,
                model: modelSource
            },
            class_type: "LoraLoaderModelOnly"
        };
        modelSource = [nodeId, 0];
        currentLoraNodeId++;
    });

    // 2. Positive Prompt
    promptFlow["2"] = { 
        inputs: { text: positive, clip: ["5", 0] }, 
        class_type: "CLIPTextEncode" 
    };

    // 4. Negative Prompt
    promptFlow["4"] = { 
        inputs: { text: negative, clip: ["5", 0] }, 
        class_type: "CLIPTextEncode" 
    };

    // 8. Empty Latent
    promptFlow["8"] = { 
        inputs: { width: width, height: height, batch_size: 1 }, 
        class_type: "EmptyLatentImage" 
    };

    // 7. KSampler (Primeira Passada)
    promptFlow["7"] = {
        inputs: {
            seed: seed, steps: 30, cfg: 7, sampler_name: "euler_ancestral", scheduler: "simple", denoise: 1,
            model: modelSource,
            positive: ["2", 0],
            negative: ["4", 0],
            latent_image: ["8", 0]
        },
        class_type: "KSampler"
    };

    // 9. VAE Decode (PADRÃO)
    promptFlow["9"] = {
        inputs: { samples: ["7", 0], vae: ["1", 2] },
        class_type: "VAEDecode"
    };

    let finalImageNodeId = "9";

    // --- BLOCO DE UPSCALE (Se > 1x) ---
    if (upscaleLevel > 1.0) {
        promptFlow["13"] = { 
            inputs: { model_name: "RealESRGAN_x4plus_anime_6B.pth" }, 
            class_type: "UpscaleModelLoader" 
        };

        promptFlow["14"] = {
            inputs: { upscale_model: ["13", 0], image: ["9", 0] },
            class_type: "ImageUpscaleWithModel"
        };

        const finalW = Math.round(width * upscaleLevel);
        const finalH = Math.round(height * upscaleLevel);

        promptFlow["15"] = {
            inputs: { 
                width: finalW, 
                height: finalH, 
                upscale_method: "nearest-exact", 
                crop: "disabled", 
                image: ["14", 0] 
            },
            class_type: "ImageScale"
        };

        promptFlow["16"] = {
            inputs: { pixels: ["15", 0], vae: ["1", 2] },
            class_type: "VAEEncode"
        };

        promptFlow["17"] = {
            inputs: {
                seed: seed, steps: 20, cfg: 7, sampler_name: "euler_ancestral", scheduler: "simple", denoise: 0.5,
                model: modelSource, 
                positive: ["2", 0],
                negative: ["4", 0],
                latent_image: ["16", 0]
            },
            class_type: "KSampler"
        };

        promptFlow["18"] = {
            inputs: { samples: ["17", 0], vae: ["1", 2] },
            class_type: "VAEDecode"
        };
        
        finalImageNodeId = "18";
    }

    // 19. Salvar Imagem
    promptFlow["19"] = {
        inputs: { images: [finalImageNodeId, 0] },
        class_type: "SaveImageWebsocket"
    };

    const loraMeta = activeLoras.length > 0 ? activeLoras.map(l => `${l.name} (${l.weight})`).join(', ') : "Nenhum";
    const metadata = { positive, negative, seed, width, height, upscale: upscaleLevel, lora: loraMeta };

    try {
        await fetch(`${API_BASE}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: promptFlow, metadata: metadata })
        });
        updateQueue(); 
        
        const toast = Swal.mixin({
            toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true, background: '#1e1e1e', color: '#fff'
        });
        toast.fire({ icon: 'success', title: 'Adicionado à fila!' });

    } catch (error) {
        Swal.fire({
            icon: 'error', title: 'Erro de Conexão', text: error.message, background: '#1e1e1e', color: '#fff'
        });
    }
});

// --- Visualização de Imagem ---
function displayImage(imgData) {
    currentImageData = imgData; 
    els.resultImage.src = imgData.url;
    els.resultImage.classList.remove('hidden');
    els.imageActions.classList.remove('hidden'); // Mostra a barra superior
    els.placeholder.classList.add('hidden');
}

function closeImage() {
    els.resultImage.classList.add('hidden');
    els.imageActions.classList.add('hidden');
    els.placeholder.classList.remove('hidden');
    els.resultImage.src = '';
    currentImageData = null;
}

function showImageMetadata() {
    if (!currentImageData) return;
    const positive = currentImageData.positive || "Não disponível";
    const negative = currentImageData.negative || "Não disponível";
    const seed = currentImageData.seed || "Desconhecido";
    const lora = currentImageData.lora || "Nenhum";
    const dims = (currentImageData.width && currentImageData.height) ? `${currentImageData.width}x${currentImageData.height}` : "Desconhecido";
    const upscale = currentImageData.upscale ? `${currentImageData.upscale}x` : "Padrão";

    Swal.fire({
        title: '<strong>Metadados da Imagem</strong>',
        html: `
            <div style="text-align: left; font-size: 0.9rem; color: #e0e0e0;">
                <p><strong style="color: #bb86fc;">Seed:</strong> ${seed}</p>
                <p><strong style="color: #bb86fc;">Dimensões:</strong> ${dims}</p>
                <p><strong style="color: #bb86fc;">Upscale:</strong> ${upscale}</p>
                <p><strong style="color: #bb86fc;">LoRA:</strong> ${lora}</p>
                <hr style="border-color: #333; margin: 10px 0;">
                <p><strong style="color: #03dac6;">Positivo:</strong><br><span style="font-size:0.85rem; color: #ccc;">${positive}</span></p>
                <div style="margin-top:10px;"></div>
                <p><strong style="color: #cf6679;">Negativo:</strong><br><span style="font-size:0.85rem; color: #ccc;">${negative}</span></p>
            </div>
        `,
        background: '#1e1e1e', color: '#fff', showCloseButton: true, focusConfirm: false, confirmButtonText: 'Fechar', confirmButtonColor: '#bb86fc'
    });
}

// --- Toggle de Galeria ---
function toggleGallery() {
    els.mainContent.classList.toggle('gallery-hidden');
    
    const isHidden = els.mainContent.classList.contains('gallery-hidden');
    const icon = els.toggleGalleryBtn.querySelector('.material-icons');
    
    if (isHidden) {
        icon.innerText = 'visibility_off';
        els.toggleGalleryBtn.title = "Mostrar Galeria";
    } else {
        icon.innerText = 'visibility';
        els.toggleGalleryBtn.title = "Ocultar Galeria";
    }
}

// --- Event Listeners ---
function setupEventListeners() {
    els.closeImgBtn.addEventListener('click', (e) => { e.preventDefault(); closeImage(); });
    els.infoImgBtn.addEventListener('click', (e) => { e.preventDefault(); showImageMetadata(); });
    els.toggleSelectModeBtn.addEventListener('click', (e) => { e.preventDefault(); toggleSelectionMode(); });
    els.deleteBatchBtn.addEventListener('click', (e) => { e.preventDefault(); deleteBatchImages(); });
    
    els.searchInput.addEventListener('input', filterAndRenderGallery);

    // LoRA Modal
    els.addLoraRowBtn.addEventListener('click', (e) => {
        e.preventDefault();
        createLoraRow();
    });
    els.manageLorasBtn.addEventListener('click', (e) => {
        e.preventDefault(); 
        openLoraModal();
    });
    els.closeLoraModalBtn.addEventListener('click', (e) => { e.preventDefault(); closeLoraModal(); });
    els.addLoraBtn.addEventListener('click', (e) => { e.preventDefault(); addLora(); });
    
    // Adicionar Lora com tecla Enter
    els.newLoraInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addLora();
        }
    });

    // Configurações
    els.settingsBtn.addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
    els.closeSettingsBtn.addEventListener('click', (e) => { e.preventDefault(); closeSettings(); });
    els.cancelSettingsAction.addEventListener('click', (e) => { e.preventDefault(); closeSettings(); });
    els.saveSettingsBtn.addEventListener('click', (e) => { e.preventDefault(); saveConfig(); });

    // Toggle Galeria
    els.toggleGalleryBtn.addEventListener('click', (e) => { e.preventDefault(); toggleGallery(); });

    // Seed
    els.randomSeedBtn.addEventListener('change', toggleSeedInput);

    // Upscale
    els.upscaleInput.addEventListener('input', updateUpscaleDisplay);

    // Deletar Único
    els.deleteImgBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!currentImageData || !currentImageData.filename) return;
        const result = await Swal.fire({
            title: 'Excluir imagem?', text: "Você não poderá reverter isso!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'Sim, excluir!', cancelButtonText: 'Cancelar', background: '#1e1e1e', color: '#fff'
        });
        if (result.isConfirmed) {
            try {
                await fetch(`${API_BASE}/api/image/${currentImageData.filename}`, { method: 'DELETE' });
                Swal.fire({ title: 'Excluído!', text: 'A imagem foi removida.', icon: 'success', timer: 1500, showConfirmButton: false, background: '#1e1e1e', color: '#fff' });
                lastGallerySignature = ""; 
                updateGallery(); 
                closeImage();
            } catch (err) {
                Swal.fire({ icon: 'error', title: 'Erro', text: 'Não foi possível excluir.', background: '#1e1e1e', color: '#fff' });
            }
        }
    });
}

init();
