import subprocess
import os
import threading
import time
from flask import Blueprint
from flask_socketio import emit, disconnect
from flask_cors import cross_origin

terminal_bp = Blueprint('terminal', __name__)

# Словарь для хранения активных процессов по session_id
active_processes = {}

def execute_command(command, session_id, socketio):
    """Выполняет команду и отправляет результат через WebSocket"""
    try:
        # Создаем процесс с псевдо-терминалом для интерактивности
        process = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.PIPE,
            text=True,
            bufsize=1,
            universal_newlines=True,
            cwd=os.path.expanduser('~')  # Устанавливаем домашнюю директорию как рабочую
        )
        
        # Сохраняем процесс для возможности его завершения
        active_processes[session_id] = process
        
        # Читаем вывод построчно
        while True:
            output = process.stdout.readline()
            if output == '' and process.poll() is not None:
                break
            if output:
                socketio.emit('terminal_output', {
                    'data': output,
                    'session_id': session_id
                }, room=session_id)
        
        # Получаем код возврата
        return_code = process.poll()
        
        # Отправляем информацию о завершении команды
        socketio.emit('command_finished', {
            'return_code': return_code,
            'session_id': session_id
        }, room=session_id)
        
        # Удаляем процесс из активных
        if session_id in active_processes:
            del active_processes[session_id]
            
    except Exception as e:
        socketio.emit('terminal_error', {
            'error': str(e),
            'session_id': session_id
        }, room=session_id)
        
        # Удаляем процесс из активных в случае ошибки
        if session_id in active_processes:
            del active_processes[session_id]

def setup_terminal_events(socketio):
    """Настраивает обработчики событий WebSocket для терминала"""
    
    @socketio.on('connect')
    def handle_connect():
        print('Client connected')
        emit('connected', {'data': 'Connected to terminal'})
    
    @socketio.on('disconnect')
    def handle_disconnect():
        print('Client disconnected')
        # Завершаем все активные процессы для этого клиента
        # В реальном приложении нужно было бы отслеживать session_id по клиентам
    
    @socketio.on('execute_command')
    def handle_execute_command(data):
        command = data.get('command', '').strip()
        session_id = data.get('session_id', 'default')
        
        if not command:
            emit('terminal_error', {
                'error': 'Empty command',
                'session_id': session_id
            })
            return
        
        # Присоединяем клиента к комнате с его session_id
        from flask_socketio import join_room
        join_room(session_id)
        
        # Отправляем эхо команды
        emit('terminal_output', {
            'data': f'$ {command}\n',
            'session_id': session_id
        })
        
        # Выполняем команду в отдельном потоке
        thread = threading.Thread(
            target=execute_command,
            args=(command, session_id, socketio)
        )
        thread.daemon = True
        thread.start()
    
    @socketio.on('kill_process')
    def handle_kill_process(data):
        session_id = data.get('session_id', 'default')
        
        if session_id in active_processes:
            try:
                process = active_processes[session_id]
                process.terminate()
                time.sleep(0.1)
                if process.poll() is None:
                    process.kill()
                
                emit('terminal_output', {
                    'data': '\n^C\n',
                    'session_id': session_id
                })
                
                del active_processes[session_id]
                
            except Exception as e:
                emit('terminal_error', {
                    'error': f'Error killing process: {str(e)}',
                    'session_id': session_id
                })
        else:
            emit('terminal_error', {
                'error': 'No active process to kill',
                'session_id': session_id
            })

