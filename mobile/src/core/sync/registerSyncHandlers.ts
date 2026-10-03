/**
 * Registra los handlers de sincronización de cada funcionalidad.
 * Importarlo una vez al arrancar (en el layout raíz) basta: cada archivo se
 * registra solo al cargarse. Agregar un tipo de acción nuevo = un archivo más
 * aquí, sin tocar el motor (principio abierto/cerrado).
 */
import '@/features/posts/postsSync';
import '@/features/comments/commentsSync';
import '@/features/messages/messagesSync';
