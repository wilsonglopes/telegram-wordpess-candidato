<?php
/**
 * Plugin Name: CampanhaPress
 * Description: Publicação automatizada via bot Telegram para campanhas políticas. Recebe matérias com chapéu editorial, resumo e imagem. Integrado à Plataforma Candidatos.
 * Version:     1.0.0
 * Author:      Plataforma Candidatos
 * Text Domain: campanhapress
 */

if ( ! defined( 'ABSPATH' ) ) exit;

// ── Ativação: gera chave automaticamente ─────────────────────────────────────
register_activation_hook( __FILE__, 'cpub_activate' );
function cpub_activate() {
    if ( ! get_option( 'cpub_api_key' ) ) {
        update_option( 'cpub_api_key', wp_generate_password( 40, false ) );
    }
}

add_action( 'admin_init', function () {
    if ( ! get_option( 'cpub_api_key' ) ) {
        update_option( 'cpub_api_key', wp_generate_password( 40, false ) );
    }
    if ( isset( $_POST['cpub_regenerate'] ) && check_admin_referer( 'cpub_regenerate_nonce' ) ) {
        if ( current_user_can( 'manage_options' ) ) {
            update_option( 'cpub_api_key', wp_generate_password( 40, false ) );
            wp_redirect( admin_url( 'admin.php?page=campanhapress&cpub_regenerated=1' ) );
            exit;
        }
    }
} );

// ── Menu ─────────────────────────────────────────────────────────────────────
add_action( 'admin_menu', function () {
    add_menu_page(
        'CampanhaPress',
        'CampanhaPress',
        'manage_options',
        'campanhapress',
        'cpub_settings_page',
        'dashicons-megaphone',
        3
    );
} );

function cpub_settings_page() {
    $api_key     = get_option( 'cpub_api_key', '' );
    $regenerated = isset( $_GET['cpub_regenerated'] );
    ?>
    <div class="wrap">
        <h1 style="display:flex;align-items:center;gap:10px;">
            <span class="dashicons dashicons-megaphone" style="font-size:1.6rem;color:#2563eb;margin-top:3px;"></span>
            CampanhaPress
        </h1>
        <p style="color:#666;margin-top:4px;">Integração com a Plataforma Candidatos — publicação automática via bot Telegram.</p>

        <?php if ( $regenerated ) : ?>
            <div class="notice notice-warning is-dismissible">
                <p><strong>Chave regenerada.</strong> Copie a nova chave e atualize no painel da Plataforma Candidatos.</p>
            </div>
        <?php endif; ?>

        <div style="background:#fff;border:1px solid #c3c4c7;border-radius:6px;padding:24px 28px;max-width:640px;margin-top:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
            <h2 style="margin-top:0;font-size:1.05rem;color:#1d2327;">🔑 Chave de integração</h2>
            <p style="color:#555;margin:0 0 14px;font-size:.92rem;">
                Copie esta chave e cole no painel da Plataforma Candidatos, no cadastro deste site.
            </p>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <input type="text" id="cpub-api-key" readonly
                       value="<?php echo esc_attr( $api_key ); ?>"
                       style="flex:1;font-family:monospace;font-size:.9rem;padding:9px 12px;border:2px solid #2563eb;border-radius:5px;background:#eff6ff;color:#1d2327;" />
                <button type="button" onclick="cpubCopy()"
                        style="padding:9px 18px;background:#2563eb;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:.88rem;font-weight:600;">
                    📋 Copiar
                </button>
            </div>
            <p id="cpub-copy-msg" style="display:none;color:#16a34a;font-size:.82rem;font-weight:600;margin:0 0 16px;">
                ✅ Chave copiada! Cole no painel da Plataforma Candidatos.
            </p>
            <form method="post" style="margin-top:16px;padding-top:14px;border-top:1px solid #f0f0f1;"
                  onsubmit="return confirm('Regenerar a chave vai desconectar o sistema até você atualizar no painel. Confirmar?');">
                <?php wp_nonce_field( 'cpub_regenerate_nonce' ); ?>
                <input type="submit" name="cpub_regenerate" class="button button-secondary" value="🔄 Regenerar chave" />
            </form>
        </div>

        <div style="background:#fff;border:1px solid #c3c4c7;border-radius:6px;padding:24px 28px;max-width:640px;margin-top:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
            <h2 style="margin-top:0;font-size:1.05rem;color:#1d2327;">📋 Como ativar</h2>
            <ol style="margin:0;padding-left:20px;color:#444;font-size:.92rem;line-height:1.9;">
                <li><strong>Instale e ative</strong> este plugin no WordPress do candidato.</li>
                <li><strong>Copie a chave</strong> acima clicando em <em>📋 Copiar</em>.</li>
                <li>Acesse o <strong>painel da Plataforma Candidatos</strong> e vá em <strong>Gerenciar → Dados</strong> do candidato.</li>
                <li>Cole a chave no campo <strong>"Chave do Plugin CampanhaPress"</strong> e salve.</li>
                <li>Pronto! O bot Telegram já pode publicar matérias automaticamente com chapéu editorial.</li>
            </ol>
        </div>
    </div>
    <script>
    function cpubCopy() {
        var input = document.getElementById('cpub-api-key');
        var msg   = document.getElementById('cpub-copy-msg');
        input.select();
        try { document.execCommand('copy'); } catch(e) {}
        if (navigator.clipboard) navigator.clipboard.writeText(input.value).catch(()=>{});
        msg.style.display = 'block';
        setTimeout(function(){ msg.style.display = 'none'; }, 3000);
    }
    </script>
    <?php
}

// ── Endpoints REST ────────────────────────────────────────────────────────────
add_action( 'rest_api_init', function () {
    register_rest_route( 'cpub/v1', '/publish', [
        'methods'             => 'POST',
        'callback'            => 'cpub_handle_publish',
        'permission_callback' => '__return_true',
    ] );
    register_rest_route( 'cpub/v1', '/categories', [
        'methods'             => 'GET',
        'callback'            => 'cpub_handle_categories',
        'permission_callback' => '__return_true',
    ] );
} );

function cpub_handle_categories( WP_REST_Request $request ) {
    $api_key  = get_option( 'cpub_api_key', '' );
    $sent_key = $request->get_header( 'X-CampanhaPress-Key' );
    if ( ! $api_key || ! hash_equals( $api_key, (string) $sent_key ) ) {
        return new WP_REST_Response( [ 'error' => 'Chave inválida.' ], 401 );
    }
    $terms = get_terms( [ 'taxonomy' => 'category', 'hide_empty' => false, 'number' => 200 ] );
    if ( is_wp_error( $terms ) ) return new WP_REST_Response( [ 'error' => $terms->get_error_message() ], 500 );
    return new WP_REST_Response( array_map( function( $t ) {
        return [ 'id' => $t->term_id, 'name' => $t->name, 'parent' => $t->parent ?: null ];
    }, $terms ), 200 );
}

function cpub_handle_publish( WP_REST_Request $request ) {
    $api_key  = get_option( 'cpub_api_key', '' );
    if ( ! $api_key ) return new WP_REST_Response( [ 'error' => 'Chave não configurada.' ], 500 );

    $sent_key = $request->get_header( 'X-CampanhaPress-Key' );
    if ( ! hash_equals( $api_key, (string) $sent_key ) ) {
        return new WP_REST_Response( [ 'error' => 'Chave inválida.' ], 401 );
    }

    $d = $request->get_json_params();
    if ( ! $d ) return new WP_REST_Response( [ 'error' => 'Payload JSON inválido.' ], 400 );

    $title       = sanitize_text_field( $d['title']       ?? '' );
    $chapeu      = sanitize_text_field( $d['chapeu']      ?? '' );
    $summary     = sanitize_text_field( $d['summary']     ?? '' );
    $body        = wp_kses_post(        $d['body']        ?? '' );
    $slug        = sanitize_title(      $d['slug']        ?? '' );
    $source_url  = esc_url_raw(         $d['source_url']  ?? '' );
    $source_name = sanitize_text_field( $d['source_name'] ?? '' );
    $image_url   = esc_url_raw(         $d['image_url']   ?? '' );
    $post_format = sanitize_text_field( $d['post_format'] ?? 'editorial' );
    $tags        = array_map( 'sanitize_text_field', (array) ( $d['tags']         ?? [] ) );
    $cat_ids     = array_map( 'intval',               (array) ( $d['category_ids'] ?? [] ) );

    if ( ! $title ) return new WP_REST_Response( [ 'error' => 'Título obrigatório.' ], 400 );

    // Tags
    $tag_ids = [];
    foreach ( $tags as $tag_name ) {
        if ( ! $tag_name ) continue;
        $term = get_term_by( 'name', $tag_name, 'post_tag' );
        if ( $term ) { $tag_ids[] = $term->term_id; }
        else {
            $new = wp_insert_term( $tag_name, 'post_tag' );
            if ( ! is_wp_error( $new ) ) $tag_ids[] = $new['term_id'];
        }
    }

    // Imagem destacada
    $featured_id  = 0;
    $embedded_img = $image_url;

    if ( $image_url ) {
        require_once ABSPATH . 'wp-admin/includes/image.php';
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';

        $tmp = download_url( $image_url );
        if ( ! is_wp_error( $tmp ) ) {
            $ext  = strtolower( pathinfo( parse_url( $image_url, PHP_URL_PATH ), PATHINFO_EXTENSION ) );
            if ( $ext === 'jfif' ) $ext = 'jpg';
            $ext  = in_array( $ext, [ 'jpg', 'jpeg', 'png', 'webp', 'gif' ] ) ? $ext : 'jpg';
            $file = [
                'name'     => sanitize_file_name( $slug ?: 'imagem' ) . '.' . $ext,
                'type'     => 'image/' . ( $ext === 'jpg' ? 'jpeg' : $ext ),
                'tmp_name' => $tmp,
                'error'    => 0,
                'size'     => filesize( $tmp ),
            ];
            $media_id = media_handle_sideload( $file, 0, $title );
            @unlink( $tmp );
            if ( ! is_wp_error( $media_id ) ) {
                $featured_id  = $media_id;
                $embedded_img = wp_get_attachment_url( $media_id ) ?: $image_url;
            }
        }
    }

    // Monta conteúdo
    $content = '';
    if ( $post_format === 'editorial' ) {
        if ( $summary )      $content .= '<p class="cpub-resumo" style="font-size:1.05em;color:#444;margin:0 0 1.5rem;line-height:1.6;font-style:italic;">' . esc_html( $summary ) . '</p>' . "\n";
        if ( $embedded_img ) $content .= '<figure class="cpub-figura" style="margin:0 0 1.5rem;">'
            . '<img src="' . esc_url( $embedded_img ) . '" alt="' . esc_attr( $title ) . '" style="width:100%;max-width:100%;height:auto;display:block;border-radius:4px;" />'
            . '</figure>' . "\n";
    }
    $content .= $body;
    if ( $source_url || $source_name ) {
        $display = $source_name ?: parse_url( $source_url, PHP_URL_HOST );
        $content .= '<p class="cpub-fonte" style="font-size:.82em;color:#888;margin:1.8rem 0 0;border-top:1px solid #eee;padding-top:.75rem;">'
            . 'Fonte: <a href="' . esc_url( $source_url ) . '" target="_blank" rel="noopener" style="color:#888;">' . esc_html( $display ) . '</a></p>' . "\n";
    }

    // Cria post
    $admins    = get_users( [ 'role' => 'administrator', 'number' => 1, 'orderby' => 'ID', 'order' => 'ASC' ] );
    $author_id = ! empty( $admins ) ? $admins[0]->ID : 1;

    $post_data = [
        'post_title'   => $title,
        'post_name'    => $slug,
        'post_excerpt' => $summary,
        'post_content' => $content,
        'post_status'  => 'publish',
        'post_type'    => 'post',
        'post_author'  => $author_id,
        'tags_input'   => $tag_ids,
    ];
    if ( ! empty( $cat_ids ) ) $post_data['post_category'] = $cat_ids;

    $post_id = wp_insert_post( $post_data, true );
    if ( is_wp_error( $post_id ) ) return new WP_REST_Response( [ 'error' => $post_id->get_error_message() ], 500 );

    // Metas
    if ( $chapeu )       update_post_meta( $post_id, '_cpub_chapeu',      $chapeu );
    if ( $source_url )   update_post_meta( $post_id, '_cpub_source_url',  $source_url );
    if ( $source_name )  update_post_meta( $post_id, '_cpub_source_name', $source_name );
    if ( $embedded_img ) update_post_meta( $post_id, '_cpub_image_url',   $embedded_img );

    if ( $featured_id ) set_post_thumbnail( $post_id, $featured_id );

    $img_url = $featured_id ? ( wp_get_attachment_url( $featured_id ) ?: $embedded_img ) : $embedded_img;

    return new WP_REST_Response( [
        'success'            => true,
        'post_id'            => $post_id,
        'post_url'           => get_permalink( $post_id ),
        'featured_image_url' => $img_url ?: '',
    ], 201 );
}

// ── Chapéu acima do título ────────────────────────────────────────────────────
add_filter( 'the_title', function ( $title, $post_id = null ) {
    if ( ! is_singular( 'post' ) )                          return $title;
    if ( is_admin() || wp_doing_ajax() || wp_doing_cron() ) return $title;
    if ( ! in_the_loop() )                                  return $title;

    $pid = absint( $post_id ?: get_the_ID() );
    if ( ! $pid || $pid !== (int) get_queried_object_id() ) return $title;
    if ( strpos( $title, 'cpub-chapeu-label' ) !== false )  return $title;

    $chapeu = get_post_meta( $pid, '_cpub_chapeu', true );
    if ( ! $chapeu ) return $title;

    return '<span class="cpub-chapeu-label" style="display:block;font-size:1.5rem;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#6b7280;margin:0 0 .5rem;line-height:1.3;">'
        . esc_html( $chapeu ) . '</span>' . $title;
}, 10, 2 );

// ── CSS para imagem full-width ────────────────────────────────────────────────
add_action( 'wp_head', function () {
    if ( ! is_singular( 'post' ) ) return;
    $pid = get_the_ID();
    if ( ! $pid || ! get_post_meta( $pid, '_cpub_image_url', true ) ) return;
    echo '<style id="cpub-img-style">
        .cpub-figura { display:block!important; width:100%!important; margin:0 0 1.5rem!important; }
        .cpub-figura img { width:100%!important; max-width:100%!important; height:auto!important; display:block!important; border-radius:4px; }
        .cpub-chapeu-label { color:#6b7280!important; }
    </style>' . "\n";
}, 99 );
