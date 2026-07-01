import { useNavigate, useParams } from 'react-router-dom';
import ChatConversation from '../components/ChatConversation';
import { useAuth } from '../auth/AuthProvider';
import './ChatThread.css';

export default function ChatThread() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="thread">
      <ChatConversation chatId={id} me={user?.id ?? ''} onBack={() => navigate('/chat')} />
    </div>
  );
}
