import { useNavigate } from 'react-router-dom';
import Landing from '../components/Landing';
import { Background } from './AuthLayout';

export default function LandingPage() {
  const navigate = useNavigate();
  return (
    <div className="page page--landing">
      <Background />
      <Landing
        onLogin={() => navigate('/login')}
        onRegister={() => navigate('/register')}
        onHome={() => navigate('/')}
      />
    </div>
  );
}
