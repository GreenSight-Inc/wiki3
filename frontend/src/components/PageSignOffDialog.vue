<template>
  <w-dialog v-model="dialogVisible" @hide="onDialogHide">
    <w-card style="min-width: 450px; max-width: 600px">
      <w-card-section class="card-header">
        <w-icon name="mdi:check-decagram-outline" size="sm" class="mr-2" />
        <span>{{ t('common.page.signOff.title') }}</span>
      </w-card-section>
      <w-card-section>
        <div class="text-body2">{{ summary }}</div>
        <div v-if="status && !status.isLive" class="text-caption text-black/54 dark:text-white/60">
          {{ t('common.page.signOff.notLive') }}
        </div>
      </w-card-section>
      <!-- -> The approvers and their verdicts, for whoever the server lists them to -->
      <w-list v-if="status?.entries?.length > 0" class="mx-4 mb-2 rounded" bordered separator>
        <w-item v-for="entry of status.entries" :key="entry.userId">
          <w-item-section>
            <w-item-label>{{ entry.name }}</w-item-label>
            <w-item-label v-if="entry.comment" caption>{{ entry.comment }}</w-item-label>
            <w-item-label v-if="!entry.canRead" caption class="text-negative">
              {{ t('common.page.signOff.noAccess') }}
            </w-item-label>
          </w-item-section>
          <w-item-section side>
            <w-chip
              size="sm"
              :color="VERDICT_COLORS[entry.verdict ?? 'pending']"
              :text-color="entry.verdict ? `white` : null"
              :label="t(VERDICT_LABELS[entry.verdict ?? 'pending'])" />
          </w-item-section>
        </w-item>
      </w-list>
      <w-card-section v-if="canAct && state.requestingChanges">
        <w-input
          ref="iptComment"
          v-model="state.comment"
          type="textarea"
          autogrow
          outlined
          dense
          :label="t(`common.page.signOff.comment`)" />
      </w-card-section>
      <w-card-actions class="card-actions">
        <w-space />
        <w-btn
          class="acrylic-btn"
          flat
          :label="t(`common.actions.close`)"
          color="cancel"
          padding="xs md"
          @click="onDialogCancel" />
        <template v-if="canAct">
          <!-- -> The way back to signing, without closing the dialog -->
          <w-btn
            v-if="state.requestingChanges"
            flat
            icon="mdi:arrow-left"
            :label="t(`common.page.signOff.back`)"
            padding="xs md"
            :disable="state.busy"
            @click="stopRequestingChanges" />
          <w-btn
            v-if="state.requestingChanges"
            unelevated
            icon="mdi:message-alert"
            :label="t(`common.page.signOff.requestChanges`)"
            color="negative"
            padding="xs md"
            :disable="!state.comment.trim()"
            :loading="state.busy"
            @click="requestChanges" />
          <template v-else>
            <w-btn
              flat
              icon="mdi:message-alert"
              :label="t(`common.page.signOff.requestChanges`)"
              color="negative"
              padding="xs md"
              @click="startRequestingChanges" />
            <w-btn
              unelevated
              icon="mdi:check"
              :label="t(`common.page.signOff.sign`)"
              color="positive"
              padding="xs md"
              :loading="state.busy"
              @click="sign" />
          </template>
        </template>
      </w-card-actions>
    </w-card>
  </w-dialog>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { computed, nextTick, onMounted, reactive, ref } from 'vue'

import { apiErrorMessage } from '@/helpers/apiError'
import { dialogComponentEmits, useDialogComponent } from '@/composables/dialog'
import { notify } from '@/composables/notify'

import { usePageStore } from '@/stores/page'

/**
 * Where the sign-off of the page in front of the reader stands, opened from the header badge.
 *
 * The approvers and their verdicts for whoever the server lists them to -- writers, managers and the
 * approvers themselves -- and the counts alone for everybody else. A current approver signs the
 * version they are reading here, or asks for changes to it with a comment.
 */

// EMITS

defineEmits([...dialogComponentEmits])

// DIALOG

const { dialogVisible, onDialogHide, onDialogCancel } = useDialogComponent()

// STORES

const pageStore = usePageStore()

// I18N

const { t } = useI18n()

// DATA

const state = reactive({
  busy: false,
  requestingChanges: false,
  comment: ''
})

/** The full status, which the page payload's summary is not: it lists the approvers. */
const status = ref(null)

// REFS

const iptComment = ref(null)

const VERDICT_LABELS = {
  signed: 'common.page.signOff.verdictSigned',
  changesRequested: 'common.page.signOff.verdictChanges',
  pending: 'common.page.signOff.verdictPending'
}
const VERDICT_COLORS = { signed: 'positive', changesRequested: 'negative', pending: null }

// COMPUTED

const current = computed(() => status.value ?? pageStore.signOff)

const summary = computed(() => {
  const s = current.value
  if (!s) {
    return ''
  }
  if (s.isApproved) {
    return t('common.page.signOff.approved')
  }
  if (s.changesRequested > 0) {
    return t('common.page.signOff.changesRequested')
  }
  return t(s.mode === 'approve' ? 'common.page.signOff.pending' : 'common.page.signOff.reviewed', {
    signed: s.signed,
    required: s.required
  })
})

// -> Only the approvers act, and only on a live page with a version to sign
const canAct = computed(
  () =>
    Boolean(status.value?.viewer?.isApprover) &&
    status.value.isLive &&
    Boolean(status.value.versionId)
)

// METHODS

async function load() {
  try {
    status.value = await pageStore.pageLoadSignOff()
  } catch (err) {
    notify({ type: 'negative', message: apiErrorMessage(err) })
  }
}

function startRequestingChanges() {
  state.requestingChanges = true
  nextTick(() => iptComment.value?.focus())
}

function stopRequestingChanges() {
  state.requestingChanges = false
  state.comment = ''
}

function sign() {
  record('signed')
}

function requestChanges() {
  record('changesRequested')
}

async function record(verdict) {
  state.busy = true
  try {
    status.value = await pageStore.pageRecordSignOff({
      versionId: status.value.versionId,
      verdict,
      comment: verdict === 'changesRequested' ? state.comment.trim() : undefined
    })
    state.requestingChanges = false
    state.comment = ''
  } catch (err) {
    // -> A newer version landed between reading and signing: say so, and show that one instead
    if (err.response?.status === 409) {
      notify({ type: 'warning', message: t('common.page.signOff.stale') })
      await load()
    } else {
      notify({ type: 'negative', message: apiErrorMessage(err) })
    }
  } finally {
    state.busy = false
  }
}

// MOUNTED

onMounted(load)
</script>
