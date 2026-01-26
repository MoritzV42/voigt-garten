-- Voigt-Garten Database Schema
-- Run with: wrangler d1 execute voigt-garten-db --file=./src/lib/schema.sql

-- Bookings Table
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_phone TEXT,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  guests INTEGER DEFAULT 2,
  has_pets BOOLEAN DEFAULT 0,
  total_price DECIMAL(10,2) NOT NULL,
  discount_code TEXT,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Maintenance Tasks Table
CREATE TABLE IF NOT EXISTS maintenance_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  cycle_days INTEGER NOT NULL,
  credit_value DECIMAL(10,2) DEFAULT 0,
  last_done DATE,
  next_due DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'due_soon', 'overdue', 'done')),
  assigned_to TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Maintenance Log (history of completed tasks)
CREATE TABLE IF NOT EXISTS maintenance_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  completed_by TEXT NOT NULL,
  completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  photo_url TEXT,
  credit_awarded DECIMAL(10,2) DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES maintenance_tasks(id)
);

-- Service Providers Table
CREATE TABLE IF NOT EXISTS service_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  rating INTEGER DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  price_range TEXT,
  notes TEXT,
  verified BOOLEAN DEFAULT 0,
  last_used DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Provider Contact History
CREATE TABLE IF NOT EXISTS provider_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL,
  provider_email TEXT NOT NULL,
  contact_type TEXT DEFAULT 'email' CHECK (contact_type IN ('email', 'phone', 'in_person')),
  task_id INTEGER,
  task_title TEXT,
  contacted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  response_received BOOLEAN DEFAULT 0,
  response_at DATETIME,
  outcome TEXT,
  FOREIGN KEY (provider_id) REFERENCES service_providers(id),
  FOREIGN KEY (task_id) REFERENCES maintenance_tasks(id)
);

-- Email Drafts (Human-in-the-Loop)
CREATE TABLE IF NOT EXISTS email_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL,
  to_name TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  final_body TEXT,
  task_id INTEGER,
  task_title TEXT,
  provider_id INTEGER,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME,
  rejected_at DATETIME,
  sent_at DATETIME,
  FOREIGN KEY (task_id) REFERENCES maintenance_tasks(id),
  FOREIGN KEY (provider_id) REFERENCES service_providers(id)
);

-- Credits/Guthaben Table
CREATE TABLE IF NOT EXISTS credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_email TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  reason TEXT NOT NULL,
  type TEXT DEFAULT 'earned' CHECK (type IN ('earned', 'used', 'transferred', 'expired')),
  related_booking_id INTEGER,
  related_task_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (related_booking_id) REFERENCES bookings(id),
  FOREIGN KEY (related_task_id) REFERENCES maintenance_tasks(id)
);

-- Gallery Images
CREATE TABLE IF NOT EXISTS gallery_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season TEXT CHECK (season IN ('spring', 'summer', 'autumn', 'winter', 'general')),
  url TEXT NOT NULL,
  caption TEXT,
  uploaded_by TEXT,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Users (for admin access)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'family' CHECK (role IN ('admin', 'family', 'guest')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_tasks(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_next_due ON maintenance_tasks(next_due);
CREATE INDEX IF NOT EXISTS idx_credits_email ON credits(guest_email);
CREATE INDEX IF NOT EXISTS idx_email_drafts_status ON email_drafts(status);
CREATE INDEX IF NOT EXISTS idx_providers_category ON service_providers(category);

-- Insert default maintenance tasks
INSERT INTO maintenance_tasks (category, title, description, cycle_days, credit_value) VALUES
  ('rasen', 'Rasenmähen', 'Gesamter Rasen mähen und Schnittgut entsorgen', 14, 15),
  ('rasen', 'Rasenkanten schneiden', 'Kanten entlang der Beete und Wege', 30, 10),
  ('rasen', 'Vertikutieren', 'Rasen vertikutieren (Frühjahr/Herbst)', 180, 30),
  ('beete', 'Unkraut jäten', 'Alle Beete von Unkraut befreien', 14, 20),
  ('beete', 'Beete mulchen', 'Rindenmulch aufbringen', 365, 40),
  ('beete', 'Blumen gießen', 'Bei Trockenheit gießen', 3, 5),
  ('baeume', 'Hecke schneiden', 'Hecken in Form schneiden', 90, 35),
  ('baeume', 'Obstbaumschnitt', 'Winterschnitt der Obstbäume', 365, 50),
  ('baeume', 'Laub harken', 'Laub zusammenharken (Herbst)', 7, 15),
  ('brennholz', 'Holz hacken', 'Holz für Feuerstelle hacken', 180, 40),
  ('brennholz', 'Holz stapeln', 'Gehacktes Holz ordentlich stapeln', 180, 25),
  ('brennholz', 'Holzvorrat prüfen', 'Bestand kontrollieren', 30, 5),
  ('elektrik', 'Außenbeleuchtung prüfen', 'Alle Lampen testen, defekte austauschen', 90, 10),
  ('elektrik', 'Steckdosen prüfen', 'Außensteckdosen auf Funktion prüfen', 180, 15),
  ('elektrik', 'E-Check (Elektriker)', 'Professionelle Prüfung - Dienstleister beauftragen', 730, 0),
  ('putzen', 'Gartenhaus putzen', 'Innenreinigung des Gartenhauses', 30, 25),
  ('putzen', 'Terrasse reinigen', 'Terrassenplatten abkehren/schrubben', 60, 20),
  ('putzen', 'Regenrinnen reinigen', 'Laub aus Regenrinnen entfernen', 180, 20),
  ('putzen', 'Fenster putzen', 'Fenster des Gartenhauses reinigen', 90, 15),
  ('sonstiges', 'Werkzeug pflegen', 'Werkzeuge reinigen und ölen', 180, 15),
  ('sonstiges', 'Zaun kontrollieren', 'Zaunpfähle und Latten prüfen', 90, 10),
  ('sonstiges', 'Winterfest machen', 'Wasserhahn abstellen, Möbel einräumen (Herbst)', 365, 50),
  ('sonstiges', 'Frühjahrs-Check', 'Alles nach dem Winter überprüfen (Frühjahr)', 365, 50);

-- Insert admin user
INSERT INTO users (email, name, role) VALUES
  ('moritz.infinityspace42@gmail.com', 'Moritz Voigt', 'admin');
