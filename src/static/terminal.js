class WebTerminal {
    constructor() {
        this.terminal = null;
        this.socket = null;
        this.fitAddon = null;
        this.sessionId = this.generateSessionId();
        this.currentCommand = "";
        this.isConnected = false;
        this.isAuthenticated = false;

        this.loginContainer = document.getElementById("login-container");
        this.terminalApp = document.getElementById("terminal-app");
        this.passwordInput = document.getElementById("password-input");
        this.loginButton = document.getElementById("login-button");
        this.loginError = document.getElementById("login-error");

        this.setupLoginEventListeners();
    }

    generateSessionId() {
        return "session_" + Math.random().toString(36).substr(2, 9);
    }

    setupLoginEventListeners() {
        this.loginButton.addEventListener("click", () => this.authenticate());
        this.passwordInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                this.authenticate();
            }
        });
    }

    async authenticate() {
        const password = this.passwordInput.value;
        if (!password) {
            this.showLoginError("Пожалуйста, введите пароль.");
            return;
        }

        try {
            const response = await fetch("/api/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ password: password }),
            });

            if (response.ok) {
                this.isAuthenticated = true;
                this.loginContainer.style.display = "none";
                this.terminalApp.style.display = "flex";
                this.init();
            } else {
                const errorData = await response.json();
                this.showLoginError(errorData.message || "Неверный пароль.");
            }
        } catch (error) {
            this.showLoginError("Ошибка подключения к серверу.");
            console.error("Authentication error:", error);
        }
    }

    showLoginError(message) {
        this.loginError.textContent = message;
        this.loginError.classList.add("show");
        setTimeout(() => {
            this.loginError.classList.remove("show");
        }, 3000);
    }

    init() {
        this.initTerminal();
        this.initSocket();
        this.setupEventListeners();
        this.showWelcomeMessage();
    }

    initTerminal() {
        // Создаем терминал
        this.terminal = new Terminal({
            cursorBlink: true,
            cursorStyle: "block",
            fontSize: 14,
            fontFamily: "Ubuntu Mono, Courier New, monospace",
            theme: {
                background: "#300a24",
                foreground: "#ffffff",
                cursor: "#ffffff",
                selection: "rgba(255, 255, 255, 0.3)",
                black: "#2e3436",
                red: "#cc0000",
                green: "#4e9a06",
                yellow: "#c4a000",
                blue: "#3465a4",
                magenta: "#75507b",
                cyan: "#06989a",
                white: "#d3d7cf",
                brightBlack: "#555753",
                brightRed: "#ef2929",
                brightGreen: "#8ae234",
                brightYellow: "#fce94f",
                brightBlue: "#729fcf",
                brightMagenta: "#ad7fa8",
                brightCyan: "#34e2e2",
                brightWhite: "#eeeeec",
            },
            allowTransparency: true,
            convertEol: true,
            scrollback: 1000,
        });

        // Добавляем аддон для автоматического изменения размера
        this.fitAddon = new FitAddon.FitAddon();
        this.terminal.loadAddon(this.fitAddon);

        // Открываем терминал в контейнере
        this.terminal.open(document.getElementById("terminal"));
        this.fitAddon.fit();

        // Обработка ввода
        this.terminal.onData((data) => {
            if (this.isConnected && this.isAuthenticated) {
                // Обработка специальных клавиш
                if (data === "\r") { // Enter
                    this.executeCommand();
                } else if (data === "\u007f") { // Backspace
                    if (this.currentCommand.length > 0) {
                        this.currentCommand = this.currentCommand.slice(0, -1);
                        this.terminal.write("\b \b");
                    }
                } else if (data === "\u0003") { // Ctrl+C
                    this.killCurrentProcess();
                } else if (data.charCodeAt(0) >= 32) { // Печатаемые символы (включая пробел)
                    this.currentCommand += data;
                    this.terminal.write(data);
                }
            }
        });

        // Обработка изменения размера окна
        window.addEventListener("resize", () => {
            this.fitAddon.fit();
        });
    }

    initSocket() {
        // Проверяем доступность Socket.IO
        if (typeof io === 'undefined') {
            console.error("Socket.IO library not loaded");
            this.isConnected = false;
            this.updateConnectionStatus(false);
            this.terminal.write("\r\n\x1b[31mSocket.IO недоступен, работаем в автономном режиме\x1b[0m\r\n");
            this.showWelcomeMessage();
            this.showPrompt();
            return;
        }

        // Подключение к WebSocket серверу с улучшенной обработкой ошибок
        this.socket = io({
            transports: ['websocket', 'polling'],
            timeout: 20000,
            forceNew: true
        });

        this.socket.on("connect", () => {
            console.log("WebSocket connected successfully");
            this.isConnected = true;
            this.updateConnectionStatus(true);
            this.terminal.write("\r\n\x1b[32mПодключено к серверу\x1b[0m\r\n");
            this.showPrompt();
        });

        this.socket.on("disconnect", (reason) => {
            console.log("WebSocket disconnected:", reason);
            this.isConnected = false;
            this.updateConnectionStatus(false);
            this.terminal.write("\r\n\x1b[31mСоединение потеряно\x1b[0m\r\n");
        });

        this.socket.on("connect_error", (error) => {
            console.error("WebSocket connection error:", error);
            this.isConnected = false;
            this.updateConnectionStatus(false);
            this.terminal.write("\r\n\x1b[31mОшибка подключения к серверу\x1b[0m\r\n");
            
            // Показываем приветственное сообщение даже без соединения
            setTimeout(() => {
                this.showWelcomeMessage();
                this.showPrompt();
            }, 1000);
        });

        this.socket.on("terminal_output", (data) => {
            if (data.session_id === this.sessionId) {
                this.terminal.write(data.data);
            }
        });

        this.socket.on("command_finished", (data) => {
            if (data.session_id === this.sessionId) {
                this.showPrompt();
            }
        });

        this.socket.on("terminal_error", (data) => {
            if (data.session_id === this.sessionId) {
                this.terminal.write(`\r\n\x1b[31mОшибка: ${data.error}\x1b[0m\r\n`);
                this.showPrompt();
            }
        });

        this.socket.on("connected", (data) => {
            console.log("Подключен к терминалу:", data);
        });
    }

    setupEventListeners() {
        // Обработка сочетаний клавиш
        document.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.key === "c") {
                e.preventDefault();
                this.killCurrentProcess();
            }
        });

        // Фокус на терминале при клике
        document.getElementById("terminal").addEventListener("click", () => {
            this.terminal.focus();
        });

        // Автофокус при загрузке
        setTimeout(() => {
            this.terminal.focus();
        }, 100);
    }

    showWelcomeMessage() {
        const welcomeText = `\n\x1b[33m╔══════════════════════════════════════════════════════════════╗\x1b[0m\n\x1b[33m║\x1b[0m                    \x1b[32mUbuntu Web Terminal\x1b[0m                    \x1b[33m║\x1b[0m\n\x1b[33m╠══════════════════════════════════════════════════════════════╣\x1b[0m\n\x1b[33m║\x1b[0m  Добро пожаловать в веб-терминал Ubuntu!                   \x1b[33m║\x1b[0m\n\x1b[33m║\x1b[0m                                                            \x1b[33m║\x1b[0m\n\x1b[33m║\x1b[0m  Доступные команды:                                        \x1b[33m║\x1b[0m\n\x1b[33m║\x1b[0m  • ls, pwd, cd, cat, echo, whoami, date, uname           \x1b[33m║\x1b[0m\n\x1b[33m║\x1b[0m  • ps, top, df, free, uptime                             \x1b[33m║\x1b[0m\n\x1b[33m║\x1b[0m  • mkdir, rmdir, touch, rm, cp, mv                       \x1b[33m║\x1b[0m\n\x1b[33m║\x1b[0m  • grep, find, which, whereis                            \x1b[33m║\x1b[0m\n\x1b[33m║\x1b[0m  • и многие другие стандартные команды Ubuntu            \x1b[33m║\x1b[0m\n\x1b[33m║\x1b[0m                                                            \x1b[33m║\x1b[0m\n\x1b[33m║\x1b[0m  Используйте Ctrl+C для прерывания выполнения команд     \x1b[33m║\x1b[0m\n\x1b[33m╚══════════════════════════════════════════════════════════════╝\x1b[0m\n\n`;
        this.terminal.write(welcomeText);
    }

    showPrompt() {
        this.currentCommand = "";
        this.terminal.write("\r\n\x1b[32mubuntu@webterminal\x1b[0m:\x1b[34m~\x1b[0m$ ");
    }

    executeCommand() {
        if (!this.currentCommand.trim()) {
            this.showPrompt();
            return;
        }

        // Если WebSocket недоступен, показываем локальную симуляцию
        if (!this.isConnected) {
            this.simulateCommand(this.currentCommand.trim());
            this.currentCommand = "";
            return;
        }

        // Отправляем команду на сервер
        this.socket.emit("execute_command", {
            command: this.currentCommand.trim(),
            session_id: this.sessionId,
        });

        this.currentCommand = "";
    }

    simulateCommand(command) {
        // Простая симуляция команд для случаев без WebSocket
        this.terminal.write("\r\n");
        
        switch(command) {
            case "ls":
                this.terminal.write("architecture_plan.md  final_report.md  problem_analysis.md  screenshots  todo.md  web-terminal-backend\r\n");
                break;
            case "pwd":
                this.terminal.write("/home/ubuntu\r\n");
                break;
            case "whoami":
                this.terminal.write("ubuntu\r\n");
                break;
            case "date":
                this.terminal.write(new Date().toString() + "\r\n");
                break;
            case "echo hello":
                this.terminal.write("hello\r\n");
                break;
            default:
                this.terminal.write(`\x1b[31mКоманда '${command}' недоступна без подключения к серверу\x1b[0m\r\n`);
                break;
        }
        
        this.showPrompt();
    }

    killCurrentProcess() {
        if (this.isConnected && this.socket) {
            this.socket.emit("kill_process", {
                session_id: this.sessionId,
            });
        }
        this.currentCommand = "";
    }

    updateConnectionStatus(connected) {
        const statusElement = document.getElementById("connection-status");
        if (connected) {
            statusElement.textContent = "Connected";
            statusElement.className = "status-connected";
        } else {
            statusElement.textContent = "Disconnected";
            statusElement.className = "status-disconnected";
        }
    }
}

// Инициализация терминала при загрузке страницы
document.addEventListener("DOMContentLoaded", () => {
    new WebTerminal();
});

// Предотвращение случайного закрытия страницы
window.addEventListener("beforeunload", (e) => {
    e.preventDefault();
    e.returnValue = "";
});


