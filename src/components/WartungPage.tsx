import { AuthProvider } from './AuthContext';
import ProjectKanban from './ProjectKanban';

export default function WartungPage() {
  return (
    <AuthProvider>
      <ProjectKanban />
    </AuthProvider>
  );
}
