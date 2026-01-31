import { AuthProvider } from './AuthContext';
import UnifiedKanban from './UnifiedKanban';

export default function UnifiedWartungPage() {
  return (
    <AuthProvider>
      <UnifiedKanban />
    </AuthProvider>
  );
}
