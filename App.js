import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Image,
  TextInput,
  Alert,
  Modal,
  PanResponder
} from "react-native";
import * as Location from 'expo-location';
import { Audio } from "expo-av";
import OpenAI from "openai";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width } = Dimensions.get('window');

// --- OpenAI Client Initialization ---
const openai = new OpenAI({
  apiKey: "hidden", // IMPORTANT: Replace with your actual key
  dangerouslyAllowBrowser: true
});

// --- Main App Component ---
export default function App() {
  const [recording, setRecording] = useState(null);
  const [notes, setNotes] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [today, setToday] = useState(new Date().toISOString().split("T")[0]);
  const [pulseAnim] = useState(new Animated.Value(1));
  const [editingNote, setEditingNote] = useState(null);
  const [editText, setEditText] = useState("");
  const [showEditModal, setShowEditModal] = useState(false);

  // Load today's notes on startup
  useEffect(() => {
    loadNotes();
  }, []);

  // Pulse animation for recording button
  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording, pulseAnim]);

  const loadNotes = async () => {
    try {
      const stored = await AsyncStorage.getItem(`notes_${today}`);
      if (stored) {
        setNotes(JSON.parse(stored));
      }
    } catch (err) {
      console.error("Error loading notes", err);
    }
  };

  const saveNotes = async (newNotes) => {
    try {
      await AsyncStorage.setItem(`notes_${today}`, JSON.stringify(newNotes));
    } catch (err) {
      console.error("Error saving notes", err);
    }
  };

  const deleteNote = async (index) => {
    Alert.alert(
      "Delete Note",
      "Are you sure you want to delete this note?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const updatedNotes = notes.filter((_, i) => i !== index);
            setNotes(updatedNotes);
            saveNotes(updatedNotes);
          }
        }
      ]
    );
  };

  const editNote = (index) => {
    setEditingNote(index);
    setEditText(notes[index].text);
    setShowEditModal(true);
  };

  const saveEditedNote = async () => {
    if (editingNote !== null) {
      const updatedNotes = [...notes];
      updatedNotes[editingNote] = { ...updatedNotes[editingNote], text: editText };
      setNotes(updatedNotes);
      await saveNotes(updatedNotes);
      setShowEditModal(false);
      setEditingNote(null);
      setEditText("");
    }
  };

  const startRecording = async () => {
    setIsRecording(true);
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      console.log("Starting recording..");
      const { recording } = await Audio.Recording.createAsync({
        isMeteringEnabled: true,
        android: {
          extension: ".m4a",
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
        },
        ios: {
          extension: ".m4a",
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.MAX,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
      });
      setRecording(recording);
      console.log("Recording started");
    } catch (err) {
      setIsRecording(false);
      console.error("Failed to start recording", err);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    setIsRecording(false);
    console.log("Stopping recording..");
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);
    console.log("Recording stopped and stored at", uri);

    // --- Start of New Location Logic ---
    let locationString = "Location not available";
    try {
      // 1. Request permission
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Permission Denied", "Location access is needed to stamp your notes.");
      } else {
        // 2. Get coordinates
        const position = await Location.getCurrentPositionAsync({});
        
        // 3. Convert coordinates to a readable address (Reverse Geocoding)
        const placemarks = await Location.reverseGeocodeAsync(position.coords);
        
if (placemarks && placemarks[0]) {
  const { street, district, city } = placemarks[0];
  
if (placemarks && placemarks[0]) {
  const place = placemarks[0];

  // Create an array of address parts in order of specificity
  const addressParts = [
    place.street,   // e.g., "3rd Cross Road"
    place.subregion,  // e.g., "Vadavalli"
    place.district, // e.g., "Coimbatore" (can sometimes be a district name)
    place.city,     // e.g., "Coimbatore"
  ];
  
  // Filter out any null parts and remove duplicates, then join them with a comma
  const uniqueParts = [...new Set(addressParts.filter(part => part))];
  
  if (uniqueParts.length > 0) {
    locationString = uniqueParts.join(', ');
  } else {
    locationString = "Precise location unavailable";
  }
}
}
      }
    } catch (err) {
      console.error("Error fetching location", err);
    }
    // --- End of New Location Logic ---

    try {
      console.log("Preparing FormData for upload...");
      const formData = new FormData();
      formData.append('file', {
        uri: uri,
        name: 'audio.m4a',
        type: 'audio/m4a',
      });
      formData.append('model', 'whisper-1');

      console.log("Transcribing audio via manual fetch...");
      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openai.apiKey}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || "Unknown transcription error");
      }
      console.log("Transcription successful:", data.text);

      const timestamp = new Date().toLocaleTimeString();
      const newNote = {
        id: Date.now().toString(),
        time: timestamp,
        text: data.text,
        location: locationString // 4. Add location to the note object
      };
      const updatedNotes = [...notes, newNote];
      setNotes(updatedNotes);
      await saveNotes(updatedNotes);

    } catch (err) {
      console.error("Transcription error:", err);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.title}>Lights Notes</Text>
            <Text style={styles.subtitle}>{formatDate(today)}</Text>
            <View style={styles.statsContainer}>
              <Text style={styles.statsText}>{notes.length} notes today</Text>
            </View>
          </View>
          <MicIcon
            isRecording={isRecording}
            onPress={isRecording ? stopRecording : startRecording}
            pulseAnim={pulseAnim}
          />
        </View>
      </View>

      <View style={styles.notesContainer}>
        {notes.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Text style={styles.emptyIconText}>🎤</Text>
            </View>
            <Text style={styles.emptyTitle}>No notes yet</Text>
            <Text style={styles.emptySubtitle}>Tap the record button to add your first note</Text>
          </View>
        ) : (
          <>
            <View style={styles.swipeHint}>
              <Text style={styles.swipeHintText}>💡 Swipe left to delete, right to edit</Text>
            </View>
            <FlatList
              data={[...notes].reverse()}
              keyExtractor={(item, index) => item.id || index.toString()}
              renderItem={({ item, index }) => (
                <SwipeableNoteItem
                  item={item}
                  noteCount={notes.length}
                  indexInReversedList={index}
                  onEdit={() => editNote(notes.length - 1 - index)}
                  onDelete={() => deleteNote(notes.length - 1 - index)}
                />
              )}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.notesList}
            />
          </>
        )}
      </View>

      <EditModal
        visible={showEditModal}
        onClose={() => setShowEditModal(false)}
        editText={editText}
        onEditTextChange={setEditText}
        onSave={saveEditedNote}
      />
    </View>
  );
}

// ====================================================================
//  ✅ COMPONENTS MOVED OUTSIDE THE 'App' COMPONENT
// ====================================================================

const MicIcon = ({ isRecording, onPress, pulseAnim }) => (
  <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
    <TouchableOpacity
      style={[styles.micButton, isRecording ? styles.micButtonActive : styles.micButtonInactive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Image
        source={require('./assets/music_10191447.png')}
        style={[styles.micIconImage, { tintColor: '#ffffff' }]}
        resizeMode="contain"
      />
    </TouchableOpacity>
  </Animated.View>
);

const SwipeableNoteItem = ({ item, noteCount, indexInReversedList, onEdit, onDelete }) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const [isSwipeActive, setIsSwipeActive] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState(null);
  const actionOpacity = useRef(new Animated.Value(0)).current;
  const currentDirection = useRef(null);
  const SWIPE_THRESHOLD = 80;
  const ACTION_WIDTH = 80;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => (
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) &&
        Math.abs(gestureState.dx) > 15
      ),
      onPanResponderGrant: (evt, gestureState) => {
        translateX.setOffset(translateX._value);
        translateX.setValue(0);
      },
      onPanResponderMove: (evt, gestureState) => {
        const { dx } = gestureState;
        let translationValue = dx;
        const maxSwipe = ACTION_WIDTH + 40;
        if (Math.abs(dx) > maxSwipe) {
          const resistance = 0.3;
          const excess = Math.abs(dx) - maxSwipe;
          translationValue = dx > 0
            ? maxSwipe + (excess * resistance)
            : -(maxSwipe + (excess * resistance));
        }
        translateX.setValue(translationValue);
        const progress = Math.min(Math.abs(translationValue) / SWIPE_THRESHOLD, 1);
        actionOpacity.setValue(progress);
        if (Math.abs(dx) > 20) {
          const newDirection = dx > 0 ? 'right' : 'left';
          if (currentDirection.current !== newDirection) {
            currentDirection.current = newDirection;
            setTimeout(() => { setSwipeDirection(newDirection); }, 0);
          }
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        translateX.flattenOffset();
        const { dx, vx } = gestureState;
        const shouldActivateAction = Math.abs(dx) > SWIPE_THRESHOLD || Math.abs(vx) > 0.5;
        if (shouldActivateAction) {
          if (dx > 0) { // Swipe Right
            Animated.parallel([
              Animated.spring(translateX, { toValue: ACTION_WIDTH, tension: 100, friction: 8, useNativeDriver: false }),
              Animated.timing(actionOpacity, { toValue: 1, duration: 200, useNativeDriver: false })
            ]).start();
            setTimeout(() => { setIsSwipeActive(true); setSwipeDirection('right'); currentDirection.current = 'right'; }, 0);
          } else { // Swipe Left
            Animated.parallel([
              Animated.spring(translateX, { toValue: -ACTION_WIDTH, tension: 100, friction: 8, useNativeDriver: false }),
              Animated.timing(actionOpacity, { toValue: 1, duration: 200, useNativeDriver: false })
            ]).start();
            setTimeout(() => { setIsSwipeActive(true); setSwipeDirection('left'); currentDirection.current = 'left'; }, 0);
          }
        } else {
          resetSwipe();
        }
      },
      onPanResponderTerminate: () => resetSwipe(),
    })
  ).current;

  const resetSwipe = () => {
    Animated.parallel([
      Animated.spring(translateX, { toValue: 0, tension: 100, friction: 8, useNativeDriver: false }),
      Animated.timing(actionOpacity, { toValue: 0, duration: 200, useNativeDriver: false })
    ]).start(() => {
      setIsSwipeActive(false);
      setSwipeDirection(null);
      currentDirection.current = null;
    });
  };

  const handleEdit = () => { onEdit(); resetSwipe(); };
  const handleDelete = () => { onDelete(); resetSwipe(); };

  return (
    <View style={styles.swipeContainer}>
      <Animated.View style={[ styles.actionContainer, styles.editAction, { opacity: swipeDirection === 'right' ? actionOpacity : 0, transform: [{ translateX: translateX.interpolate({ inputRange: [-ACTION_WIDTH, 0, ACTION_WIDTH], outputRange: [-ACTION_WIDTH, -ACTION_WIDTH, 0], extrapolate: 'clamp' }) }] } ]}>
        <TouchableOpacity style={styles.actionButton} onPress={handleEdit} activeOpacity={0.8}>
          <Text style={styles.actionIcon}>✏️</Text><Text style={styles.actionText}>Edit</Text>
        </TouchableOpacity>
      </Animated.View>
      <Animated.View style={[ styles.actionContainer, styles.deleteAction, { opacity: swipeDirection === 'left' ? actionOpacity : 0, transform: [{ translateX: translateX.interpolate({ inputRange: [-ACTION_WIDTH, 0, ACTION_WIDTH], outputRange: [0, ACTION_WIDTH, ACTION_WIDTH], extrapolate: 'clamp' }) }] } ]}>
        <TouchableOpacity style={styles.actionButton} onPress={handleDelete} activeOpacity={0.8}>
          <Text style={styles.actionIcon}>🗑️</Text><Text style={styles.actionText}>Delete</Text>
        </TouchableOpacity>
      </Animated.View>
      <Animated.View style={[ styles.noteCard, { opacity: 1 - (indexInReversedList * 0.02), transform: [{ translateX }] } ]} {...panResponder.panHandlers}>
        <TouchableOpacity activeOpacity={0.9} onPress={isSwipeActive ? resetSwipe : undefined} disabled={!isSwipeActive}>
          <View style={styles.noteHeader}>
            <View style={styles.timeContainer}><Text style={styles.timeText}>{item.time}</Text></View>
            <View style={styles.noteNumber}><Text style={styles.noteNumberText}>{noteCount - indexInReversedList}</Text></View>
          </View>
          
          {item.location && (
            <View style={styles.locationContainer}>
              <Text style={styles.locationIcon}>📍</Text>
              <Text style={styles.locationText}>{item.location}</Text>
            </View>
          )}

          <Text style={styles.noteText}>{item.text}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const EditModal = ({ visible, onClose, editText, onEditTextChange, onSave }) => (
  <Modal visible={visible} transparent={true} animationType="slide" onRequestClose={onClose}>
    <View style={styles.modalOverlay}>
      <View style={styles.modalContent}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Edit Note</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}><Text style={styles.closeButtonText}>✕</Text></TouchableOpacity>
        </View>
        <TextInput style={styles.editTextInput} value={editText} onChangeText={onEditTextChange} multiline={true} placeholder="Edit your note..." autoFocus={true}/>
        <View style={styles.modalActions}>
          <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={onClose}><Text style={styles.cancelButtonText}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.modalButton, styles.saveButton]} onPress={onSave}><Text style={styles.saveButtonText}>Save</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

// --- Enhanced Stylesheet ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  header: { paddingTop: 60, paddingHorizontal: 24, paddingBottom: 24, backgroundColor: "#ffffff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  headerContent: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontSize: 32, fontWeight: "700", color: "#1e293b", marginBottom: 4 },
  subtitle: { fontSize: 16, color: "#64748b", marginBottom: 12 },
  statsContainer: { backgroundColor: "#f1f5f9", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, alignSelf: "flex-start" },
  statsText: { fontSize: 14, color: "#475569", fontWeight: "600" },
  micButton: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6 },
  micButtonInactive: { backgroundColor: "#3b82f6" },
  micButtonActive: { backgroundColor: "#ef4444" },
  micIconImage: { width: 24, height: 24 },
  notesContainer: { flex: 1, paddingHorizontal: 24, paddingTop: 16 },
  swipeHint: { backgroundColor: "#e0f2fe", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, marginBottom: 16, alignItems: "center", borderWidth: 1, borderColor: "#b3e5fc" },
  swipeHintText: { fontSize: 12, color: "#0277bd", fontWeight: "600" },
  notesList: { paddingBottom: 24 },
  swipeContainer: { marginBottom: 16, position: "relative", overflow: "hidden", borderRadius: 16 },
  actionContainer: { position: "absolute", top: 0, bottom: 0, width: 80, justifyContent: "center", alignItems: "center", borderRadius: 16, zIndex: 1 },
  editAction: { left: 0, backgroundColor: "#10b981" },
  deleteAction: { right: 0, backgroundColor: "#ef4444" },
  actionButton: { alignItems: "center", justifyContent: "center", padding: 12, borderRadius: 12, minHeight: 60, width: 60 },
  actionIcon: { fontSize: 20, marginBottom: 2 },
  actionText: { color: "#ffffff", fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  noteCard: { backgroundColor: "#ffffff", borderRadius: 16, padding: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4, borderLeftWidth: 4, borderLeftColor: "#3b82f6" },
  noteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  timeContainer: { backgroundColor: "#f8fafc", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  timeText: { fontSize: 12, color: "#64748b", fontWeight: "600" },
  noteNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#3b82f6", alignItems: "center", justifyContent: "center" },
  noteNumberText: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
  locationContainer: { flexDirection: "row", alignItems: "center", marginBottom: 12, marginTop: -4 },
  locationIcon: { fontSize: 12, marginRight: 6 },
  locationText: { fontSize: 12, color: '#94a3b8', fontWeight: '500' },
  noteText: { fontSize: 16, lineHeight: 24, color: "#334155" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center", marginBottom: 24 },
  emptyIconText: { fontSize: 32 },
  emptyTitle: { fontSize: 20, fontWeight: "600", color: "#475569", marginBottom: 8 },
  emptySubtitle: { fontSize: 16, color: "#94a3b8", textAlign: "center", paddingHorizontal: 32, lineHeight: 24 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.5)", justifyContent: "center", alignItems: "center" },
  modalContent: { backgroundColor: "#ffffff", borderRadius: 20, padding: 24, width: width * 0.9, maxWidth: 400, shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 20, elevation: 10 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: "700", color: "#1e293b" },
  closeButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  closeButtonText: { fontSize: 16, color: "#64748b", fontWeight: "600" },
  editTextInput: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 16, fontSize: 16, minHeight: 120, textAlignVertical: "top", backgroundColor: "#f8fafc", marginBottom: 20 },
  modalActions: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  modalButton: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cancelButton: { backgroundColor: "#f1f5f9" },
  cancelButtonText: { color: "#64748b", fontSize: 16, fontWeight: "600" },
  saveButton: { backgroundColor: "#3b82f6" },
  saveButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
