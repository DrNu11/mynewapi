/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  ImageIcon,
  LoaderCircle,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  WandSparkles,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SectionPageLayout } from '@/components/layout'
import { createWorkshopImages, getAllApiKeys } from './api'
import {
  getImageAspectRatio,
  getImageSize,
  getTokenUnavailableReason,
  IMAGE_RATIOS,
} from './lib'
import {
  IMAGE_MODEL_IDS,
  IMAGE_QUALITY_IDS,
  type GeneratedImage,
  type ImageModelId,
  type ImageQuality,
  type ImageRatioId,
  type WorkshopToken,
} from './types'

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024

export function ImageWorkshop() {
  const { t } = useTranslation()
  const [rawTokens, setRawTokens] = useState<WorkshopToken[]>([])
  const [tokensLoading, setTokensLoading] = useState(true)
  const [selectedTokenId, setSelectedTokenId] = useState('')
  const [model, setModel] = useState<ImageModelId>('gpt-image-2')
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState<ImageRatioId>('auto')
  const [count, setCount] = useState('1')
  const [quality, setQuality] = useState<ImageQuality>('auto')
  const [referenceImage, setReferenceImage] = useState<File | null>(null)
  const [referencePreview, setReferencePreview] = useState('')
  const [results, setResults] = useState<GeneratedImage[]>([])
  const [generating, setGenerating] = useState(false)
  const [lastRun, setLastRun] = useState<{
    model: ImageModelId
    ratio: ImageRatioId
    quality: ImageQuality
  } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const referencePreviewRef = useRef('')

  const loadTokens = useCallback(async () => {
    setTokensLoading(true)
    try {
      const items = await getAllApiKeys()
      setRawTokens(items.map((token) => ({ ...token, usable: true })))
    } catch (error) {
      setRawTokens([])
      toast.error(
        error instanceof Error ? error.message : t('Failed to load API keys')
      )
    } finally {
      setTokensLoading(false)
    }
  }, [t])

  useEffect(() => {
    let active = true
    getAllApiKeys()
      .then((items) => {
        if (active) {
          setRawTokens(items.map((token) => ({ ...token, usable: true })))
        }
      })
      .catch((error: unknown) => {
        if (!active) return
        setRawTokens([])
        toast.error(
          error instanceof Error ? error.message : t('Failed to load API keys')
        )
      })
      .finally(() => {
        if (active) setTokensLoading(false)
      })
    return () => {
      active = false
    }
  }, [t])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (referencePreviewRef.current) {
        URL.revokeObjectURL(referencePreviewRef.current)
      }
    }
  }, [])

  const tokens = useMemo(
    () =>
      rawTokens.map((token) => {
        const unavailableReason = getTokenUnavailableReason(token, model)
        return { ...token, usable: !unavailableReason, unavailableReason }
      }),
    [model, rawTokens]
  )

  const selectedToken = useMemo(
    () => tokens.find((token) => String(token.id) === selectedTokenId),
    [selectedTokenId, tokens]
  )
  const usableTokens = useMemo(
    () => tokens.filter((token) => token.usable),
    [tokens]
  )
  const actualSize = getImageSize(model, ratio)
  let tokenSelectLabel = t('Select an API key')
  if (tokensLoading) tokenSelectLabel = t('Loading API keys...')
  if (selectedToken?.usable) tokenSelectLabel = selectedToken.name
  const canGenerate =
    !generating &&
    Boolean(selectedToken?.usable) &&
    prompt.trim().length > 0 &&
    prompt.length <= 32000

  const handleReferenceImage = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error(t('Please select an image file'))
      return
    }
    if (file.size > MAX_REFERENCE_BYTES) {
      toast.error(t('Reference image must be smaller than 20 MB'))
      return
    }
    if (referencePreviewRef.current) {
      URL.revokeObjectURL(referencePreviewRef.current)
    }
    const nextPreview = URL.createObjectURL(file)
    referencePreviewRef.current = nextPreview
    setReferenceImage(file)
    setReferencePreview(nextPreview)
  }

  const handleGenerate = async () => {
    if (!canGenerate || !selectedToken) return
    const controller = new AbortController()
    abortRef.current = controller
    setGenerating(true)
    setResults([])

    try {
      const generated = await createWorkshopImages(
        {
          tokenId: selectedToken.id,
          model,
          prompt,
          ratio,
          quality,
          count: Number(count),
          referenceImage,
        },
        controller.signal
      )
      setResults(generated)
      setLastRun({ model, ratio, quality })
      toast.success(t('Images generated'))
    } catch (error) {
      if (controller.signal.aborted) {
        toast.message(t('Generation cancelled'))
      } else {
        toast.error(
          error instanceof Error ? error.message : t('Image generation failed')
        )
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setGenerating(false)
    }
  }

  const downloadImage = (image: GeneratedImage, index: number) => {
    const link = document.createElement('a')
    link.href = image.src
    link.download = `nassa-${lastRun?.model ?? model}-${index + 1}.png`
    link.rel = 'noopener'
    link.click()
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Image Workshop')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <div className='flex items-center gap-2'>
          <Badge variant='secondary' className='gap-1.5'>
            <ShieldCheck className='size-3.5' />
            {t('Keys stay in this session')}
          </Badge>
          <Badge variant='outline' className='gap-1.5'>
            <Sparkles className='size-3.5' />
            {t('Beta')}
          </Badge>
        </div>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='grid min-h-full gap-3 lg:grid-cols-[minmax(19rem,24rem)_minmax(0,1fr)]'>
          <Card className='h-fit gap-0 overflow-hidden py-0'>
            <CardHeader className='border-b p-4'>
              <CardTitle className='flex items-center gap-2 text-base'>
                <WandSparkles className='text-primary size-4' />
                {t('Creation controls')}
              </CardTitle>
              <CardDescription>
                {t('Choose a key and describe the image you want to make.')}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-5 p-4'>
              <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2'>
                <div className='space-y-1.5'>
                  <div className='flex items-center justify-between gap-2'>
                    <Label htmlFor='image-token'>{t('API Key')}</Label>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-xs'
                      aria-label={t('Refresh API keys')}
                      disabled={tokensLoading}
                      onClick={() => void loadTokens()}
                    >
                      <RefreshCcw
                        className={cn(
                          'size-3.5',
                          tokensLoading && 'animate-spin'
                        )}
                      />
                    </Button>
                  </div>
                  <Select
                    value={selectedToken?.usable ? selectedTokenId : ''}
                    onValueChange={(value) => setSelectedTokenId(String(value))}
                    disabled={tokensLoading || tokens.length === 0}
                  >
                    <SelectTrigger id='image-token' className='h-9 w-full'>
                      <SelectValue>{tokenSelectLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {tokens.map((token) => (
                        <SelectItem
                          key={token.id}
                          value={String(token.id)}
                          disabled={!token.usable}
                        >
                          <span className='flex min-w-0 flex-col'>
                            <span className='truncate'>{token.name}</span>
                            {token.unavailableReason && (
                              <span className='text-muted-foreground text-[11px]'>
                                {token.unavailableReason}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1.5'>
                  <Label htmlFor='image-model'>{t('Model')}</Label>
                  <Select
                    value={model}
                    onValueChange={(value) => setModel(value as ImageModelId)}
                  >
                    <SelectTrigger id='image-model' className='h-9 w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMAGE_MODEL_IDS.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {!tokensLoading && usableTokens.length === 0 && (
                <Alert className='border-amber-500/30 bg-amber-500/10'>
                  <AlertDescription>
                    {t('No enabled API key can access this image model.')}
                  </AlertDescription>
                </Alert>
              )}

              <div className='space-y-1.5'>
                <div className='flex items-center justify-between gap-2'>
                  <Label htmlFor='image-prompt'>{t('Prompt')}</Label>
                  <span className='text-muted-foreground text-[11px] tabular-nums'>
                    {prompt.length.toLocaleString()} / 32,000
                  </span>
                </div>
                <Textarea
                  id='image-prompt'
                  value={prompt}
                  maxLength={32000}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={t(
                    'Describe the subject, light, composition, color and texture.'
                  )}
                  className='min-h-36 resize-y leading-relaxed'
                />
              </div>

              <fieldset className='space-y-2'>
                <div className='flex items-end justify-between gap-3'>
                  <legend className='text-sm leading-none font-medium'>
                    {t('Aspect ratio')}
                  </legend>
                  <span className='text-muted-foreground text-[11px] tabular-nums'>
                    {actualSize ?? t('Model decides')}
                  </span>
                </div>
                <div className='grid grid-cols-4 gap-1.5'>
                  {IMAGE_RATIOS.map((item) => (
                    <button
                      key={item.id}
                      type='button'
                      title={item.hint}
                      aria-pressed={ratio === item.id}
                      onClick={() => setRatio(item.id)}
                      className={cn(
                        'focus-visible:ring-ring flex h-12 flex-col items-center justify-center rounded-lg border text-xs transition-colors outline-none focus-visible:ring-2',
                        ratio === item.id
                          ? 'border-primary bg-primary/8 text-primary'
                          : 'border-border hover:bg-muted/60 text-muted-foreground'
                      )}
                    >
                      <span className='font-medium'>{item.label}</span>
                      {item.id !== 'auto' && (
                        <span
                          aria-hidden='true'
                          className='mt-1 rounded-[2px] border border-current opacity-60'
                          style={{
                            width: `${Math.min(18, 12 * (item.width / item.height))}px`,
                            height: `${Math.min(18, 12 * (item.height / item.width))}px`,
                          }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className='grid grid-cols-2 gap-3'>
                <div className='space-y-1.5'>
                  <Label htmlFor='image-count'>{t('Image count')}</Label>
                  <Select
                    value={count}
                    onValueChange={(value) => setCount(String(value))}
                  >
                    <SelectTrigger id='image-count' className='h-9 w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4].map((item) => (
                        <SelectItem key={item} value={String(item)}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1.5'>
                  <Label htmlFor='image-quality'>{t('Quality')}</Label>
                  <Select
                    value={quality}
                    onValueChange={(value) => setQuality(value as ImageQuality)}
                  >
                    <SelectTrigger id='image-quality' className='h-9 w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMAGE_QUALITY_IDS.map((item) => (
                        <SelectItem key={item} value={item}>
                          {t(item === 'auto' ? 'Auto' : item)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className='space-y-2'>
                <div className='flex items-center justify-between gap-2'>
                  <Label>{t('Reference image')}</Label>
                  <span className='text-muted-foreground text-[11px]'>
                    {t('Optional · max 20 MB')}
                  </span>
                </div>
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='image/*'
                  className='sr-only'
                  onChange={(event) =>
                    handleReferenceImage(event.target.files?.[0])
                  }
                />
                {referenceImage && referencePreview ? (
                  <div className='bg-muted/30 relative flex items-center gap-3 rounded-xl border p-2'>
                    <img
                      src={referencePreview}
                      alt={t('Reference preview')}
                      className='size-16 rounded-lg object-cover'
                    />
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-sm font-medium'>
                        {referenceImage.name}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {(referenceImage.size / 1024 / 1024).toFixed(2)} MB ·{' '}
                        {t('Image edit mode')}
                      </p>
                    </div>
                    <Button
                      type='button'
                      size='icon-sm'
                      variant='ghost'
                      aria-label={t('Remove reference image')}
                      onClick={() => {
                        if (referencePreviewRef.current) {
                          URL.revokeObjectURL(referencePreviewRef.current)
                          referencePreviewRef.current = ''
                        }
                        setReferenceImage(null)
                        setReferencePreview('')
                        if (fileInputRef.current)
                          fileInputRef.current.value = ''
                      }}
                    >
                      <X className='size-4' />
                    </Button>
                  </div>
                ) : (
                  <button
                    type='button'
                    onClick={() => fileInputRef.current?.click()}
                    className='border-border hover:bg-muted/40 focus-visible:ring-ring flex w-full items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-5 text-left transition-colors outline-none focus-visible:ring-2'
                  >
                    <span className='bg-muted flex size-9 items-center justify-center rounded-lg'>
                      <UploadCloud className='text-muted-foreground size-4' />
                    </span>
                    <span>
                      <span className='block text-sm font-medium'>
                        {t('Add a reference image')}
                      </span>
                      <span className='text-muted-foreground block text-xs'>
                        {t('The request will use the image edits endpoint.')}
                      </span>
                    </span>
                  </button>
                )}
              </div>

              <div className='flex gap-2'>
                <Button
                  type='button'
                  className='h-10 flex-1 gap-2'
                  disabled={!canGenerate}
                  onClick={() => void handleGenerate()}
                >
                  {generating ? (
                    <LoaderCircle className='size-4 animate-spin' />
                  ) : (
                    <Sparkles className='size-4' />
                  )}
                  {generating ? t('Generating...') : t('Start generating')}
                </Button>
                {generating && (
                  <Button
                    type='button'
                    variant='outline'
                    className='h-10'
                    onClick={() => abortRef.current?.abort()}
                  >
                    {t('Cancel')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className='min-h-[36rem] gap-0 overflow-hidden py-0'>
            <CardHeader className='border-b p-4'>
              <div className='flex items-start justify-between gap-3'>
                <div>
                  <CardTitle className='text-base'>
                    {t('Generation canvas')}
                  </CardTitle>
                  <CardDescription>
                    {t(
                      'Results only stay on this page. Download them before leaving.'
                    )}
                  </CardDescription>
                </div>
                {results.length > 0 && (
                  <Badge variant='secondary' className='tabular-nums'>
                    {results.length} {t('images')}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className='flex min-h-[31rem] flex-col p-3 sm:p-4'>
              {generating ? (
                <div className='grid flex-1 place-items-center rounded-xl border border-dashed'>
                  <div className='flex max-w-sm flex-col items-center text-center'>
                    <div className='bg-primary/10 text-primary mb-4 flex size-14 items-center justify-center rounded-2xl'>
                      <LoaderCircle className='size-6 animate-spin' />
                    </div>
                    <p className='font-medium'>{t('Rendering your image')}</p>
                    <p className='text-muted-foreground mt-1 text-sm'>
                      {t(
                        'Large images can take several minutes. Keep this page open.'
                      )}
                    </p>
                  </div>
                </div>
              ) : results.length === 0 ? (
                <Empty className='flex-1 border'>
                  <EmptyHeader>
                    <EmptyMedia variant='icon' className='size-12 rounded-2xl'>
                      <ImageIcon className='size-5' />
                    </EmptyMedia>
                    <EmptyTitle>{t('Your canvas is ready')}</EmptyTitle>
                    <EmptyDescription>
                      {t(
                        'Choose an API key, write a prompt and start generating. Your images will appear here.'
                      )}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className='grid gap-3 sm:grid-cols-2'>
                  {results.map((image, index) => (
                    <figure
                      key={image.id}
                      className='group bg-muted/20 overflow-hidden rounded-xl border'
                    >
                      <div
                        className='bg-muted/40 relative grid min-h-56 place-items-center overflow-hidden'
                        style={{
                          aspectRatio: getImageAspectRatio(
                            lastRun?.ratio ?? ratio
                          ),
                        }}
                      >
                        <img
                          src={image.src}
                          alt={`${t('Generated image')} ${index + 1}`}
                          className='size-full object-contain'
                        />
                        <Button
                          type='button'
                          size='icon-sm'
                          variant='secondary'
                          aria-label={t('Download image')}
                          className='absolute top-2 right-2 opacity-100 shadow-sm sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-visible:opacity-100'
                          onClick={() => downloadImage(image, index)}
                        >
                          <Download className='size-4' />
                        </Button>
                      </div>
                      <figcaption className='flex items-center justify-between gap-3 px-3 py-2'>
                        <div className='min-w-0'>
                          <p className='truncate text-xs font-medium'>
                            {t('Frame')} {String(index + 1).padStart(2, '0')}
                          </p>
                          <p className='text-muted-foreground truncate text-[11px]'>
                            {lastRun?.model} · {lastRun?.ratio} ·{' '}
                            {lastRun?.quality}
                          </p>
                        </div>
                        <span className='text-muted-foreground font-mono text-[10px] uppercase'>
                          Nassa proof
                        </span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
